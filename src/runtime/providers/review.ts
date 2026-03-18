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

export interface ReviewResult {
  approved: boolean
  body: string
  comments: Array<{ path: string, body: string, diffHunk: string }>
  pr: number
  url: string
}

export interface ReviewCapConfig {
  /** Path to the agent's local clone */
  cloneDir: string
  /** Nix git store path */
  git: string
  /** GitHub owner/repo (e.g. "user/repo"). Auto-detected from origin if not provided. */
  repo?: string
  /** GitHub API token. Falls back to GITHUB_TOKEN env or `gh auth token`. */
  token?: string
  /** Base branch for PRs. Default: "main" */
  baseBranch?: string
  /** Poll interval in ms. Default: 5000 */
  pollInterval?: number
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

  /** Ensure the clone can push to GitHub */
  private ensureRemote(): void {
    if (this.remoteSet)
      return

    const git = join(this.config.git, 'bin', 'git')
    const repo = this.getRepo()
    const token = this.getToken()

    // Set up authenticated push URL as 'github' remote
    const pushUrl = `https://x-access-token:${token}@github.com/${repo}.git`
    const remotes = execFileSync(git, ['remote'], { cwd: this.config.cloneDir, encoding: 'utf-8' })
    if (remotes.split('\n').includes('github'))
      execFileSync(git, ['remote', 'set-url', 'github', pushUrl], { cwd: this.config.cloneDir })
    else
      execFileSync(git, ['remote', 'add', 'github', pushUrl], { cwd: this.config.cloneDir })

    this.remoteSet = true
  }

  /**
   * Push a branch to GitHub and open/update a PR.
   * Returns immediately with the PR URL.
   */
  @tool(z.object({
    branch: z.string().describe('Branch name to propose (must exist with commits)'),
    title: z.string().describe('PR title'),
    body: z.string().optional().describe('PR description'),
  }))
  async openPR({ branch, title, body }: { branch: string, title: string, body?: string }): Promise<{ pr: number, url: string, sha: string }> {
    this.ensureRemote()
    const git = join(this.config.git, 'bin', 'git')
    const repo = this.getRepo()
    const token = this.getToken()
    const base = this.config.baseBranch ?? 'main'

    // Get HEAD sha
    const sha = execFileSync(git, ['rev-parse', branch], {
      cwd: this.config.cloneDir,
      encoding: 'utf-8',
    }).trim()

    // Push to GitHub
    execFileSync(git, ['push', 'github', `${branch}:${branch}`], {
      cwd: this.config.cloneDir,
      timeout: 30000,
      stdio: 'ignore',
    })

    // Check for existing open PR for this branch
    const existing = await ghApi<any[]>(token, 'GET',
      `/repos/${repo}/pulls?state=open&head=${repo.split('/')[0]}:${branch}`)

    let prNumber: number
    let prUrl: string
    if (existing.length > 0) {
      prNumber = existing[0].number
      prUrl = existing[0].html_url
      await ghApi(token, 'PATCH', `/repos/${repo}/pulls/${prNumber}`, { title, body: body ?? '' })
    }
    else {
      const pr = await ghApi<any>(token, 'POST', `/repos/${repo}/pulls`, {
        title,
        body: body ?? '',
        head: branch,
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
    const token = this.getToken()
    const git = join(this.config.git, 'bin', 'git')
    const interval = this.config.pollInterval ?? 5000

    while (true) {
      const reviews = await ghApi<any[]>(token, 'GET',
        `/repos/${repo}/pulls/${pr}/reviews`)

      for (const review of reviews) {
        if (review.state === 'PENDING')
          continue

        // Check if review is on the target SHA or a descendant
        if (review.commit_id) {
          try {
            execFileSync(git, ['fetch', 'github', '--quiet'], {
              cwd: this.config.cloneDir, timeout: 10000, stdio: 'ignore',
            })
            execFileSync(git, ['merge-base', '--is-ancestor', sha, review.commit_id], {
              cwd: this.config.cloneDir, stdio: 'ignore',
            })
          }
          catch {
            continue // review on older commit
          }
        }

        // Fetch review comments
        const comments: ReviewResult['comments'] = []
        const reviewComments = await ghApi<any[]>(token, 'GET',
          `/repos/${repo}/pulls/${pr}/reviews/${review.id}/comments`)
        for (const c of reviewComments) {
          comments.push({
            path: c.path ?? '',
            body: c.body ?? '',
            diffHunk: c.diff_hunk ?? '',
          })
        }

        return {
          approved: review.state === 'APPROVED',
          body: review.body ?? '',
          comments,
          pr,
          url: `https://github.com/${repo}/pull/${pr}`,
        }
      }

      // Check if PR was closed/merged
      const prData = await ghApi<any>(token, 'GET', `/repos/${repo}/pulls/${pr}`)
      if (prData.state === 'closed')
        return { approved: false, body: 'PR was closed', comments: [], pr, url: prData.html_url }

      await sleep(interval)
    }
  }

  /** List open PRs on the repo */
  async listOpenPRs(): Promise<Array<{ number: number, title: string, branch: string, url: string }>> {
    const repo = this.getRepo()
    const token = this.getToken()
    const prs = await ghApi<any[]>(token, 'GET', `/repos/${repo}/pulls?state=open`)
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
