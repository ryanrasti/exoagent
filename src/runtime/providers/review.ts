import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tool } from '../../exoeval/tool'
import type { Secrets } from './secrets'
import { z } from 'zod'

/**
 * Review provider — GitHub PR-based code review.
 *
 * Pushes branches to GitHub, opens PRs, fetches reviews.
 * Git push assumes the host has SSH/credentials configured.
 * Only GitHub API operations use the token (from secrets DB).
 */

/** Review result — uses GitHub API shapes directly (no wrapper types) */
export interface ReviewResult {
  approved: boolean
  body: string
  /** Inline review comments (GitHub PullRequestReviewComment objects) */
  comments: any[]
  /** PR-level issue comments (GitHub IssueComment objects) */
  issueComments: any[]
  pr: number
  url: string
}

export interface ReviewCapConfig {
  /** Path to the agent's local clone */
  cloneDir: string
  /** Nix git store path */
  git: string
  /** Secrets DB for reading GITHUB_TOKEN */
  secrets: Secrets
  /** GitHub owner/repo (e.g. "user/repo") */
  repo: string
  /** Base branch for PRs. Default: "main" */
  baseBranch?: string
  /** Poll interval in ms. Default: 5000 */
  pollInterval?: number
  /** Agent name for branch prefixing. Default: "default" */
  agentName?: string
}

export class ReviewCap {
  private config: ReviewCapConfig

  constructor(config: ReviewCapConfig) {
    this.config = config
  }

  /** Read GITHUB_TOKEN from the secrets DB. */
  private get token(): string {
    const t = this.config.secrets.get('review', 'GITHUB_TOKEN')
    if (!t) {
      throw new Error('No GITHUB_TOKEN in secrets DB. Use the secrets UI to set it.')
    }
    return t
  }

  /** Prefix branch name with agent namespace. */
  private qualifyBranch(branch: string): string {
    const agentName = this.config.agentName ?? 'default'
    const prefix = `exoagent-${agentName}/`
    if (branch.startsWith(prefix)) {
      return branch
    }
    return `${prefix}${branch}`
  }

  /**
   * Push a branch to GitHub and open/update a PR.
   * Returns immediately with the PR URL.
   * Remote branch will be auto-prefixed with `exoagent-<agent>/`.
   */
  @tool(z.object({
    branch: z.string(),
    title: z.string(),
    body: z.string().optional(),
  }))
  async openPR({ branch, title, body }: { branch: string, title: string, body?: string }): Promise<{ pr: number, url: string, sha: string }> {
    const git = join(this.config.git, 'bin', 'git')
    const repo = this.config.repo
    const token = this.token
    const base = this.config.baseBranch ?? 'main'
    const remoteBranch = this.qualifyBranch(branch)

    // Get HEAD sha
    const sha = execFileSync(git, ['rev-parse', branch], {
      cwd: this.config.cloneDir,
      encoding: 'utf-8',
    }).trim()

    // Push via host credentials (SSH key, credential helper, etc.)
    execFileSync(git, ['push', 'origin', `${branch}:${remoteBranch}`, '--force'], {
      cwd: this.config.cloneDir,
      timeout: 30000,
      stdio: 'ignore',
    })

    // Check for existing open PR for this branch
    const owner = repo.split('/')[0]
    const searchParams = new URLSearchParams({ state: 'open', head: `${owner}:${remoteBranch}` })
    const existing = await ghApi<any[]>(token, 'GET',
      `/repos/${encodeURI(repo)}/pulls?${searchParams}`)

    let prNumber: number
    let prUrl: string
    if (existing.length > 0) {
      prNumber = existing[0].number
      prUrl = existing[0].html_url
      await ghApi(token, 'PATCH', `/repos/${encodeURI(repo)}/pulls/${prNumber}`, { title, body: body ?? '' })
    }
    else {
      const pr = await ghApi<any>(token, 'POST', `/repos/${encodeURI(repo)}/pulls`, {
        title,
        body: body ?? '',
        head: remoteBranch,
        base,
      })
      prNumber = pr.number
      prUrl = pr.html_url
    }

    return { pr: prNumber, url: prUrl, sha }
  }

  /**
   * Get the latest review on a PR. Returns immediately (non-blocking).
   * Returns the most recent non-pending review with its comments.
   */
  @tool(z.object({
    pr: z.number(),
  }))
  async getReviews({ pr }: { pr: number }): Promise<ReviewResult> {
    const repo = this.config.repo
    const repoPath = encodeURI(repo)
    const token = this.token

    // Fetch all reviews
    const reviews = await ghApi<any[]>(token, 'GET', `/repos/${repoPath}/pulls/${pr}/reviews`)

    // Find latest non-pending review
    const latest = [...reviews].reverse().find((r: any) => r.state !== 'PENDING')

    let comments: any[] = []
    let approved = false
    let reviewBody = ''

    if (latest) {
      approved = latest.state === 'APPROVED'
      reviewBody = latest.body ?? ''

      // Fetch review comments — pass through raw API objects
      comments = await ghApi<any[]>(token, 'GET',
        `/repos/${repoPath}/pulls/${pr}/reviews/${latest.id}/comments`)
    }

    // Fetch issue comments — pass through raw API objects
    const issueComments = await ghApi<any[]>(token, 'GET', `/repos/${repoPath}/issues/${pr}/comments`)

    return {
      approved,
      body: reviewBody,
      comments,
      issueComments,
      pr,
      url: `https://github.com/${encodeURI(repo)}/pull/${pr}`,
    }
  }

  /**
   * Reply to a specific review comment on a PR.
   */
  @tool(z.object({
    pr: z.number(),
    commentId: z.number(),
    body: z.string(),
  }))
  async replyToComment({ pr, commentId, body }: { pr: number, commentId: number, body: string }): Promise<{ id: number }> {
    const repo = this.config.repo
    const token = this.token
    const result = await ghApi<any>(token, 'POST',
      `/repos/${encodeURI(repo)}/pulls/${pr}/comments/${commentId}/replies`,
      { body })
    return { id: result.id }
  }

  /**
   * Post a general comment on a PR (issue-level comment).
   */
  @tool(z.object({
    pr: z.number(),
    body: z.string(),
  }))
  async commentOnPR({ pr, body }: { pr: number, body: string }): Promise<{ id: number }> {
    const repo = this.config.repo
    const token = this.token
    const result = await ghApi<any>(token, 'POST',
      `/repos/${encodeURI(repo)}/issues/${pr}/comments`,
      { body })
    return { id: result.id }
  }

  /** List open PRs on the repo. */
  async listOpenPRs(): Promise<Array<{ number: number, title: string, branch: string, url: string }>> {
    const repo = this.config.repo
    const token = this.token
    const prs = await ghApi<any[]>(token, 'GET', `/repos/${encodeURI(repo)}/pulls?state=open`)
    return prs.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.head?.ref ?? '',
      url: pr.html_url,
    }))
  }
}

// -- GitHub API helper ------------------------------------------------------

async function ghApi<T = any>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`GitHub API ${method} ${path}: ${resp.status} ${text}`)
  }
  if (resp.status === 204) {
    return undefined as T
  }
  return resp.json() as Promise<T>
}
