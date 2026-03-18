import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tool } from '../../exoeval/tool'
import { z } from 'zod'

/**
 * Review provider — GitHub PR-based code review.
 *
 * Pushes branches to GitHub, opens PRs, polls for reviews.
 * Auth via GITHUB_TOKEN env var or `gh auth token`.
 */

export interface ReviewComment {
  id: number
  path: string
  body: string
  diffHunk: string
}

export interface PRComment {
  id: number
  body: string
  user: string
  createdAt: string
}

export interface ReviewResult {
  approved: boolean
  body: string
  comments: ReviewComment[]
  issueComments: PRComment[]
  pr: number
  url: string
}

export interface ReviewCapConfig {
  /** Path to the agent's local clone */
  cloneDir: string
  /** Nix git store path */
  git: string
  /** Secrets DB for reading GITHUB_TOKEN */
  secrets?: import('./secrets').Secrets
  /** GitHub owner/repo (e.g. "user/repo"). Auto-detected from origin if not provided. */
  repo?: string
  /** GitHub API token. Falls back to secrets DB, GITHUB_TOKEN env, or `gh auth token`. */
  token?: string
  /** Base branch for PRs. Default: "main" */
  baseBranch?: string
  /** Poll interval in ms. Default: 5000 */
  pollInterval?: number
  /** Agent name for branch prefixing. Default: "default" */
  agentName?: string
  /** Fully qualified SSH remote URL for push (e.g. ssh://git@github.com/user/repo.git). Auto-detected if not provided. */
  pushRemoteUrl?: string
}

export class ReviewCap {
  private config: ReviewCapConfig
  private _repo: string | null = null
  private _token: string | null = null
  private remoteSet = false

  constructor(config: ReviewCapConfig) {
    this.config = config
  }

  /** Resolve GitHub owner/repo from origin remote */
  private getRepo(): string {
    if (this._repo)
      return this._repo

    if (this.config.repo) {
      this._repo = this.config.repo
      return this._repo
    }

    const git = join(this.config.git, 'bin', 'git')
    const url = execFileSync(git, ['remote', 'get-url', 'origin'], {
      cwd: this.config.cloneDir,
      encoding: 'utf-8',
    }).trim()

    // Parse GitHub URL: https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/)
    if (!match)
      throw new Error(`Cannot parse GitHub repo from origin URL: ${url}`)

    this._repo = match[1]
    return this._repo
  }

  /** Resolve GitHub token */
  private getToken(): string {
    if (this._token)
      return this._token

    if (this.config.token) {
      this._token = this.config.token
      return this._token
    }

    // Try secrets DB
    if (this.config.secrets) {
      const dbToken = this.config.secrets.get('review', 'GITHUB_TOKEN')
      if (dbToken) {
        this._token = dbToken
        return this._token
      }
    }

    // Try GITHUB_TOKEN env var
    if (process.env.GITHUB_TOKEN) {
      this._token = process.env.GITHUB_TOKEN
      return this._token
    }

    // Try gh CLI
    try {
      this._token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf-8' }).trim()
      if (this._token)
        return this._token
    }
    catch {
      // gh not available
    }

    throw new Error('No GitHub token. Set GITHUB_TOKEN env var or run `gh auth login`.')
  }

  /** Get fully qualified SSH remote URL for push */
  private getPushRemoteUrl(): string {
    if (this.config.pushRemoteUrl)
      return this.config.pushRemoteUrl

    const git = join(this.config.git, 'bin', 'git')
    const url = execFileSync(git, ['remote', 'get-url', 'origin'], {
      cwd: this.config.cloneDir,
      encoding: 'utf-8',
    }).trim()

    // Normalize to ssh:// form
    // git@github.com:owner/repo.git → ssh://git@github.com/owner/repo.git
    const sshColonMatch = url.match(/^git@([^:]+):(.+)$/)
    if (sshColonMatch)
      return `ssh://git@${sshColonMatch[1]}/${sshColonMatch[2]}`

    // Already ssh:// or https:// — return as-is
    return url
  }

  /** Ensure origin has authenticated push URL */
  private ensureAuth(): void {
    if (this.remoteSet)
      return

    const git = join(this.config.git, 'bin', 'git')
    const repo = this.getRepo()
    const token = this.getToken()

    // Set origin push URL to authenticated HTTPS version
    const pushUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${repo}.git`
    execFileSync(git, ['remote', 'set-url', '--push', 'origin', pushUrl], { cwd: this.config.cloneDir })

    this.remoteSet = true
  }

  /** Prefix branch name with agent namespace */
  private qualifyBranch(branch: string): string {
    const agentName = this.config.agentName ?? 'default'
    const prefix = `exoagent-${agentName}/`
    if (branch.startsWith(prefix))
      return branch
    return `${prefix}${branch}`
  }

  @tool(z.object({
    branch: z.string().describe('Branch name to propose (must exist with commits). Will be auto-prefixed with exoagent-<agent>/'),
    title: z.string().describe('PR title'),
    body: z.string().optional().describe('PR description'),
  }))
  async openPR({ branch, title, body }: { branch: string, title: string, body?: string }): Promise<{ pr: number, url: string, sha: string }> {
    this.ensureAuth()
    const git = join(this.config.git, 'bin', 'git')
    const repo = this.getRepo()
    const token = this.getToken()
    const base = this.config.baseBranch ?? 'main'
    const remoteBranch = this.qualifyBranch(branch)

    // Get HEAD sha
    const sha = execFileSync(git, ['rev-parse', branch], {
      cwd: this.config.cloneDir,
      encoding: 'utf-8',
    }).trim()

    // Push using fully qualified remote URL (in case agent changed remotes)
    const pushUrl = this.getPushRemoteUrl()
    execFileSync(git, ['push', pushUrl, `${branch}:${remoteBranch}`, '--force'], {
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
   * Wait for a human review on a PR.
   * Only considers reviews on the given SHA or a descendant commit.
   */
  @tool(z.object({
    pr: z.number().describe('PR number to wait for review on'),
    sha: z.string().describe('Commit SHA to wait for review on (from openPR)'),
  }))
  async waitForReview({ pr, sha }: { pr: number, sha: string }): Promise<ReviewResult> {
    const repo = this.getRepo()
    const repoPath = encodeURI(repo)
    const token = this.getToken()
    const git = join(this.config.git, 'bin', 'git')
    const interval = this.config.pollInterval ?? 5000

    // Track what we've already seen so we only return new activity
    const seenReviewIds = new Set<number>()
    const seenCommentIds = new Set<number>()

    // Seed with existing reviews/comments so we only surface new ones
    const initialReviews = await ghApi<any[]>(token, 'GET', `/repos/${repoPath}/pulls/${pr}/reviews`)
    for (const r of initialReviews)
      seenReviewIds.add(r.id)

    const initialComments = await ghApi<any[]>(token, 'GET', `/repos/${repoPath}/issues/${pr}/comments`)
    for (const c of initialComments)
      seenCommentIds.add(c.id)

    while (true) {
      // Check formal reviews
      const reviews = await ghApi<any[]>(token, 'GET', `/repos/${repoPath}/pulls/${pr}/reviews`)

      for (const review of reviews) {
        if (seenReviewIds.has(review.id))
          continue
        if (review.state === 'PENDING')
          continue

        // Check if review is on the target SHA or a descendant
        if (review.commit_id) {
          try {
            execFileSync(git, ['fetch', 'origin', '--quiet'], {
              cwd: this.config.cloneDir, timeout: 10000, stdio: 'ignore',
            })
            execFileSync(git, ['merge-base', '--is-ancestor', sha, review.commit_id], {
              cwd: this.config.cloneDir, stdio: 'ignore',
            })
          }
          catch {
            seenReviewIds.add(review.id)
            continue // review on older commit
          }
        }

        // Fetch review comments
        const comments: ReviewComment[] = []
        const reviewComments = await ghApi<any[]>(token, 'GET',
          `/repos/${repoPath}/pulls/${pr}/reviews/${review.id}/comments`)
        for (const c of reviewComments) {
          comments.push({
            id: c.id,
            path: c.path ?? '',
            body: c.body ?? '',
            diffHunk: c.diff_hunk ?? '',
          })
        }

        // Also fetch any new issue comments (PR-level conversation)
        const issueComments = await this.fetchNewIssueComments(pr, seenCommentIds)

        return {
          approved: review.state === 'APPROVED',
          body: review.body ?? '',
          comments,
          issueComments,
          pr,
          url: `https://github.com/${encodeURI(repo)}/pull/${pr}`,
        }
      }

      // Even without a formal review, check for new PR-level comments
      const newIssueComments = await this.fetchNewIssueComments(pr, seenCommentIds)
      if (newIssueComments.length > 0) {
        return {
          approved: false,
          body: '',
          comments: [],
          issueComments: newIssueComments,
          pr,
          url: `https://github.com/${encodeURI(repo)}/pull/${pr}`,
        }
      }

      // Check if PR was closed/merged
      const prData = await ghApi<any>(token, 'GET', `/repos/${repoPath}/pulls/${pr}`)
      if (prData.state === 'closed')
        return { approved: false, body: 'PR was closed', comments: [], issueComments: [], pr, url: prData.html_url }

      await sleep(interval)
    }
  }

  /** Fetch issue comments newer than what we've seen */
  private async fetchNewIssueComments(pr: number, seenIds: Set<number>): Promise<PRComment[]> {
    const repo = this.getRepo()
    const token = this.getToken()
    const allComments = await ghApi<any[]>(token, 'GET', `/repos/${encodeURI(repo)}/issues/${pr}/comments`)

    const newComments: PRComment[] = []
    for (const c of allComments) {
      if (seenIds.has(c.id))
        continue
      seenIds.add(c.id)
      newComments.push({
        id: c.id,
        body: c.body ?? '',
        user: c.user?.login ?? '',
        createdAt: c.created_at ?? '',
      })
    }
    return newComments
  }

  /**
   * Reply to a specific review comment on a PR.
   */
  @tool(z.object({
    pr: z.number().describe('PR number'),
    commentId: z.number().describe('Review comment ID to reply to'),
    body: z.string().describe('Reply text'),
  }))
  async replyToComment({ pr, commentId, body }: { pr: number, commentId: number, body: string }): Promise<{ id: number }> {
    const repo = this.getRepo()
    const token = this.getToken()
    const result = await ghApi<any>(token, 'POST',
      `/repos/${encodeURI(repo)}/pulls/${pr}/comments/${commentId}/replies`,
      { body })
    return { id: result.id }
  }

  /**
   * Post a general comment on a PR (issue-level comment).
   */
  @tool(z.object({
    pr: z.number().describe('PR number'),
    body: z.string().describe('Comment text'),
  }))
  async commentOnPR({ pr, body }: { pr: number, body: string }): Promise<{ id: number }> {
    const repo = this.getRepo()
    const token = this.getToken()
    const result = await ghApi<any>(token, 'POST',
      `/repos/${encodeURI(repo)}/issues/${pr}/comments`,
      { body })
    return { id: result.id }
  }

  /** List open PRs on the repo */
  async listOpenPRs(): Promise<Array<{ number: number, title: string, branch: string, url: string }>> {
    const repo = this.getRepo()
    const token = this.getToken()
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
  if (resp.status === 204)
    return undefined as T
  return resp.json() as Promise<T>
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
