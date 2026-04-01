/**
 * GitHub provider — typed GitHub REST API methods.
 *
 * Depends on (via manifest.ts):
 *   - config: for storing/retrieving the GitHub token
 *   - fetch: for making HTTP requests to api.github.com
 */

import type { BoundEval } from '../../bound-eval'
import type { ProviderInit } from '../../provider'
import type { ScopedConfig } from '../config'
import type { FetchResponse, ScopedFetch } from '../fetch'
import z from 'zod'
import { tool } from '../../exoeval/tool'

export type GitHubCaps = {
	config: ScopedConfig
	fetch: ScopedFetch
}

// ── Response types ─────────────────────────────────────────────

type User = {
	login: string
	id: number
	name: string | null
	avatar_url: string
}

type Repo = {
	id: number
	full_name: string
	private: boolean
	description: string | null
	default_branch: string
	language: string | null
	stargazers_count: number
	open_issues_count: number
}

type Issue = {
	number: number
	title: string
	body: string | null
	state: string
	labels: { name: string }[]
	assignees: { login: string }[]
	user: { login: string }
	created_at: string
	updated_at: string
	html_url: string
}

type Comment = {
	id: number
	body: string
	user: { login: string }
	created_at: string
}

type PR = {
	number: number
	title: string
	body: string | null
	state: string
	head: { ref: string, sha: string }
	base: { ref: string }
	user: { login: string }
	mergeable: boolean | null
	created_at: string
	updated_at: string
	html_url: string
}

// ── Provider ───────────────────────────────────────────────────

export type GitHubProviderImpl = InstanceType<typeof GitHubProvider>

class GitHubProvider {
	private readonly exoEval: BoundEval<GitHubCaps>

	constructor(exoEval: BoundEval<GitHubCaps>) {
		this.exoEval = exoEval

		this.exoEval(({ config }) =>
			config.setSchema({
				token: {
					type: 'string',
					isRequired: true,
					isSecret: true,
					description: 'GitHub Personal Access Token (classic) with repo scope. [Create one](https://github.com/settings/tokens/new)',
				},
			}),
		)
	}

	private getToken(): string {
		const token = this.exoEval(({ config }) => config.get('token')) as string | null
		if (!token) { throw new Error('no token configured') }
		return token
	}

	private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
		const token = this.getToken()
		const url = `https://api.github.com${path}`
		const headers: { [key: string]: string } = {
			'Authorization': `Bearer ${token}`,
			'User-Agent': 'exoagent',
			'Accept': 'application/vnd.github+json',
		}
		if (body) { headers['Content-Type'] = 'application/json' }

		const fetchBody = body ? JSON.stringify(body) : undefined
		const res = (await this.exoEval(
			({ fetch }) => fetch.fetch(url, { method, headers, body: fetchBody }),
			{ url, method, headers, fetchBody },
		)) as FetchResponse

		if (res.status >= 400) {
			throw new Error(`GitHub API ${method} ${path}: ${res.status} ${res.body}`)
		}

		return res.body ? JSON.parse(res.body) as T : {} as T
	}

	private get<T>(path: string): Promise<T> { return this.api<T>('GET', path) }
	private post<T>(path: string, body: unknown): Promise<T> { return this.api<T>('POST', path, body) }
	private patch<T>(path: string, body: unknown): Promise<T> { return this.api<T>('PATCH', path, body) }

	// ── Auth ─────────────────────────────────────────────────

	/** Test the token and return the authenticated user. */
	@tool()
	async testConnection(): Promise<User> {
		return this.get<User>('/user')
	}

	// ── Users ────────────────────────────────────────────────

	@tool(z.string())
	async getUser(username: string): Promise<User> {
		return this.get<User>(`/users/${encodeURIComponent(username)}`)
	}

	// ── Repos ────────────────────────────────────────────────

	/** List repos for the authenticated user, or for an org. */
	@tool(z.string().optional(), z.number().optional())
	async listRepos(org?: string, perPage?: number): Promise<Repo[]> {
		const n = perPage ?? 30
		const path = org
			? `/orgs/${encodeURIComponent(org)}/repos?per_page=${n}&sort=updated`
			: `/user/repos?per_page=${n}&sort=updated`
		return this.get<Repo[]>(path)
	}

	@tool(z.string(), z.string())
	async getRepo(owner: string, repo: string): Promise<Repo> {
		return this.get<Repo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)
	}

	// ── Issues ───────────────────────────────────────────────

	@tool(z.string(), z.string(), z.enum(['open', 'closed', 'all']).optional(), z.number().optional())
	async listIssues(owner: string, repo: string, state?: 'open' | 'closed' | 'all', perPage?: number): Promise<Issue[]> {
		const s = state ?? 'open'
		const n = perPage ?? 30
		return this.get<Issue[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=${s}&per_page=${n}`)
	}

	@tool(z.string(), z.string(), z.number())
	async getIssue(owner: string, repo: string, number: number): Promise<Issue> {
		return this.get<Issue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`)
	}

	@tool(z.string(), z.string(), z.string(), z.string().optional(), z.array(z.string()).optional(), z.array(z.string()).optional())
	async createIssue(owner: string, repo: string, title: string, body?: string, labels?: string[], assignees?: string[]): Promise<Issue> {
		const payload: { [key: string]: unknown } = { title }
		if (body) { payload.body = body }
		if (labels) { payload.labels = labels }
		if (assignees) { payload.assignees = assignees }
		return this.post<Issue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, payload)
	}

	@tool(z.string(), z.string(), z.number(), z.object({
		title: z.string().optional(),
		body: z.string().optional(),
		state: z.enum(['open', 'closed']).optional(),
		labels: z.array(z.string()).optional(),
		assignees: z.array(z.string()).optional(),
	}))
	async updateIssue(owner: string, repo: string, number: number, update: {
		title?: string
		body?: string
		state?: 'open' | 'closed'
		labels?: string[]
		assignees?: string[]
	}): Promise<Issue> {
		return this.patch<Issue>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`, update)
	}

	// ── Comments ─────────────────────────────────────────────

	@tool(z.string(), z.string(), z.number(), z.number().optional())
	async listComments(owner: string, repo: string, issueNumber: number, perPage?: number): Promise<Comment[]> {
		const n = perPage ?? 30
		return this.get<Comment[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments?per_page=${n}`)
	}

	@tool(z.string(), z.string(), z.number(), z.string())
	async addComment(owner: string, repo: string, issueNumber: number, body: string): Promise<Comment> {
		return this.post<Comment>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`, { body })
	}

	// ── Pull Requests ────────────────────────────────────────

	@tool(z.string(), z.string(), z.enum(['open', 'closed', 'all']).optional(), z.number().optional())
	async listPRs(owner: string, repo: string, state?: 'open' | 'closed' | 'all', perPage?: number): Promise<PR[]> {
		const s = state ?? 'open'
		const n = perPage ?? 30
		return this.get<PR[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=${s}&per_page=${n}`)
	}

	@tool(z.string(), z.string(), z.number())
	async getPR(owner: string, repo: string, number: number): Promise<PR> {
		return this.get<PR>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`)
	}

	// ── Provider interface ───────────────────────────────────

	clientProvider(_clientName: string): GitHubProviderImpl {
		return this
	}

	uiProvider(_clients: string[]) {
		return this
	}
}

export default ({ exoEval }: ProviderInit<GitHubCaps>) => new GitHubProvider(exoEval)
