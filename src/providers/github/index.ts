/**
 * GitHub provider — exposes GitHub API operations as @tool() methods.
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

export class GitHubProviderImpl {
	private readonly exoEval: BoundEval<GitHubCaps>

	constructor(exoEval: BoundEval<GitHubCaps>) {
		this.exoEval = exoEval

		// Register our schema with the config provider on load
		this.exoEval(({ config }) =>
			config.setSchema({
				token: {
					type: 'string',
					isRequired: true,
					isSecret: true,
					description: 'GitHub Personal Access Token (classic) with repo and read:user scopes. [Create one](https://github.com/settings/tokens/new)',
				},
			}),
		)
	}

	clientProvider(_clientName: string): GitHubProviderImpl {
		return this
	}

	uiProvider(_clients: string[]) {
		return this
	}

	@tool()
	getToken(): string | null {
		return this.exoEval(({ config }) => config.get('token')) as string | null
	}

	@tool(z.string())
	setToken(token: string): unknown {
		return this.exoEval(({ config }) => config.set('token', token), { token })
	}

	@tool()
	async testConnection(): Promise<{ login: string, id: number, name: string | null }> {
		const token = this.exoEval(({ config }) => config.get('token')) as string | null
		if (!token) {
			throw new Error('no token configured — call setToken() first')
		}

		const headers = {
			'Authorization': `Bearer ${token}`,
			'User-Agent': 'exoagent',
			'Accept': 'application/vnd.github+json',
		}
		const url = 'https://api.github.com/user'
		const res = (await this.exoEval(
			({ fetch }) => fetch.fetch(url, { headers }),
			{ url, headers },
		)) as FetchResponse
		if (res.status !== 200) {
			throw new Error(`GitHub API error ${res.status}: ${res.body}`)
		}
		const user = JSON.parse(res.body) as { login: string, id: number, name: string | null }
		return { login: user.login, id: user.id, name: user.name }
	}

	@tool(z.string())
	async getUser(username: string): Promise<{ login: string, id: number, name: string | null }> {
		const token = this.exoEval(({ config }) => config.get('token')) as string | null
		if (!token) {
			throw new Error('no token configured — call setToken() first')
		}

		const url = `https://api.github.com/users/${encodeURIComponent(username)}`
		const headers = {
			'Authorization': `Bearer ${token}`,
			'User-Agent': 'exoagent',
			'Accept': 'application/vnd.github+json',
		}
		const res = (await this.exoEval(
			({ fetch }) => fetch.fetch(url, { headers }),
			{ url, headers },
		)) as FetchResponse
		if (res.status !== 200) {
			throw new Error(`GitHub API error ${res.status}: ${res.body}`)
		}
		const user = JSON.parse(res.body) as { login: string, id: number, name: string | null }
		return { login: user.login, id: user.id, name: user.name }
	}
}

export default ({ exoEval }: ProviderInit<GitHubCaps>) => new GitHubProviderImpl(exoEval)
