import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tool } from '../../exoeval/tool'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// ForgejoServer — singleton, lazy-started, lives for the daemon's lifetime
// ---------------------------------------------------------------------------

export interface ForgejoServerConfig {
  /** The main project repo (source of truth) */
  repoDir: string
  /** Persistent data dir (e.g. .exoagent/forgejo) */
  dataDir: string
  /** Nix store paths */
  nix: { forgejo: string, git: string }
  /** Fixed port. Default: auto-assign */
  port?: number
}

interface ForgejoState {
  port: number
  proc: ReturnType<typeof spawn>
  agentToken: string
  reviewerToken: string
  remoteUrl: string
}

export class ForgejoServer {
  private static instance: ForgejoServer | null = null
  private config: ForgejoServerConfig
  private state: ForgejoState | null = null
  private startPromise: Promise<void> | null = null

  private constructor(config: ForgejoServerConfig) {
    this.config = config
  }

  static create(config: ForgejoServerConfig): ForgejoServer {
    if (!ForgejoServer.instance)
      ForgejoServer.instance = new ForgejoServer(config)
    return ForgejoServer.instance
  }

  static reset(): void {
    ForgejoServer.instance = null
  }

  async ensureRunning(): Promise<{ port: number, url: string, agentToken: string, reviewerToken: string, remoteUrl: string }> {
    if (this.state) {
      const { port, agentToken, reviewerToken, remoteUrl } = this.state
      return { port, url: `http://localhost:${port}`, agentToken, reviewerToken, remoteUrl }
    }
    if (!this.startPromise)
      this.startPromise = this.doStart()
    await this.startPromise
    const { port, agentToken, reviewerToken, remoteUrl } = this.state!
    return { port, url: `http://localhost:${port}`, agentToken, reviewerToken, remoteUrl }
  }

  private async doStart(): Promise<void> {
    const { dataDir, repoDir, nix } = this.config
    const forgejo = join(nix.forgejo, 'bin', 'forgejo')
    const git = join(nix.git, 'bin', 'git')
    const port = this.config.port ?? await findFreePort()
    const confDir = join(dataDir, 'custom', 'conf')

    await mkdir(confDir, { recursive: true })

    await writeFile(join(confDir, 'app.ini'), `[server]
HTTP_PORT = ${port}
ROOT_URL = http://localhost:${port}/
OFFLINE_MODE = true
LFS_START_SERVER = false

[database]
DB_TYPE = sqlite3

[security]
INSTALL_LOCK = true

[service]
DISABLE_REGISTRATION = true

[log]
MODE = console
LEVEL = warn
`)

    const fg = (args: string[]) =>
      execFileSync(forgejo, [...args, '-w', dataDir, '-c', join(confDir, 'app.ini')], {
        encoding: 'utf-8',
        timeout: 30000,
      })

    fg(['migrate'])

    const createUser = (username: string, admin: boolean) => {
      try {
        fg(['admin', 'user', 'create',
          ...(admin ? ['--admin'] : []),
          '--username', username, '--password', username, '--email', `${username}@localhost`,
          '--must-change-password=false'])
      }
      catch (err: any) {
        if (!String(err?.stderr ?? err).includes('already exists'))
          throw err
      }
    }

    createUser('agent', true)
    createUser('reviewer', false)

    const agentToken = extractToken(fg(['admin', 'user', 'generate-access-token',
      '--username', 'agent', '--token-name', `api-${Date.now()}`, '--scopes', 'all']))
    const reviewerToken = extractToken(fg(['admin', 'user', 'generate-access-token',
      '--username', 'reviewer', '--token-name', `api-${Date.now()}`, '--scopes', 'all']))

    const proc = spawn(forgejo, ['web', '-w', dataDir, '-c', join(confDir, 'app.ini')], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const baseUrl = `http://localhost:${port}`
    await waitForReady(baseUrl, 15000)

    const remoteUrl = `http://agent:agent@localhost:${port}/agent/workspace.git`
    this.state = { port, proc, agentToken, reviewerToken, remoteUrl }

    // Ensure repo exists on Forgejo
    const repoResp = await fetch(`${baseUrl}/api/v1/repos/agent/workspace`, {
      headers: { 'Authorization': `token ${agentToken}` },
    })
    if (repoResp.status === 404) {
      await forgejoApi(baseUrl, agentToken, 'POST', '/api/v1/user/repos', {
        name: 'workspace',
        auto_init: true,
      })
    }

    // Reviewer can review PRs
    await forgejoApi(baseUrl, agentToken, 'PUT',
      '/api/v1/repos/agent/workspace/collaborators/reviewer',
      { permission: 'write' })

    // Push main from source repo to Forgejo
    const remotes = execFileSync(git, ['remote'], { cwd: repoDir, encoding: 'utf-8' })
    if (remotes.split('\n').includes('forgejo'))
      execFileSync(git, ['remote', 'set-url', 'forgejo', remoteUrl], { cwd: repoDir })
    else
      execFileSync(git, ['remote', 'add', 'forgejo', remoteUrl], { cwd: repoDir })

    try {
      execFileSync(git, ['push', 'forgejo', 'main', '--force'], { cwd: repoDir, timeout: 30000 })
    }
    catch {
      // No main branch yet — fine
    }
  }

  async stop(): Promise<void> {
    if (!this.state)
      return
    this.state.proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      this.state!.proc.on('close', () => resolve())
      setTimeout(resolve, 5000)
    })
    this.state = null
    this.startPromise = null
  }

  get port(): number | null { return this.state?.port ?? null }
  get url(): string | null { return this.state ? `http://localhost:${this.state.port}` : null }
}

// ---------------------------------------------------------------------------
// ReviewCap — per-agent cap for proposing PRs from a local clone
// ---------------------------------------------------------------------------

export interface ReviewResult {
  approved: boolean
  body: string
  comments: Array<{ path: string, body: string, diffHunk: string }>
  pr: number
  url: string
}

export interface ReviewCapConfig {
  /** Reference to the singleton Forgejo server */
  server: ForgejoServer
  /** Path to the agent's local clone (created via git clone --local) */
  cloneDir: string
  /** Nix git store path */
  git: string
  /** Poll interval in ms. Default: 2000 */
  pollInterval?: number
}

export class ReviewCap {
  private config: ReviewCapConfig
  private remoteAdded = false

  constructor(config: ReviewCapConfig) {
    this.config = config
  }

  /** Ensure the clone has the forgejo remote */
  private async ensureRemote(): Promise<{ baseUrl: string, token: string }> {
    const { url, agentToken, remoteUrl } = await this.config.server.ensureRunning()
    if (!this.remoteAdded) {
      const git = join(this.config.git, 'bin', 'git')
      const remotes = execFileSync(git, ['remote'], { cwd: this.config.cloneDir, encoding: 'utf-8' })
      if (remotes.split('\n').includes('forgejo'))
        execFileSync(git, ['remote', 'set-url', 'forgejo', remoteUrl], { cwd: this.config.cloneDir })
      else
        execFileSync(git, ['remote', 'add', 'forgejo', remoteUrl], { cwd: this.config.cloneDir })
      this.remoteAdded = true
    }
    return { baseUrl: url, token: agentToken }
  }

  /**
   * Push a branch to Forgejo, open/update a PR, and wait for human review.
   *
   * Pi should have already committed on the branch. This just syncs the
   * branch's sha to Forgejo and manages the PR lifecycle.
   */
  @tool(z.object({
    branch: z.string().describe('Branch name to propose (must exist in clone with commits)'),
    title: z.string().describe('PR title'),
    body: z.string().optional().describe('PR description'),
  }))
  async propose({ branch, title, body }: { branch: string, title: string, body?: string }): Promise<ReviewResult> {
    const { baseUrl, token } = await this.ensureRemote()
    const git = join(this.config.git, 'bin', 'git')

    // Push branch to Forgejo
    execFileSync(git, ['push', 'forgejo', `${branch}:${branch}`, '--force'], {
      cwd: this.config.cloneDir,
      encoding: 'utf-8',
      timeout: 30000,
    })

    // Find or create PR — filter by head branch
    const allOpenPrs = await forgejoApi<any[]>(baseUrl, token, 'GET',
      '/api/v1/repos/agent/workspace/pulls?state=open')
    const existingPrs = allOpenPrs.filter((pr: any) => pr.head?.ref === branch)

    let prNumber: number
    if (existingPrs.length > 0) {
      prNumber = existingPrs[0].number
      await forgejoApi(baseUrl, token, 'PATCH',
        `/api/v1/repos/agent/workspace/pulls/${prNumber}`,
        { title, body: body ?? '' })
    }
    else {
      const pr = await forgejoApi<any>(baseUrl, token, 'POST',
        '/api/v1/repos/agent/workspace/pulls',
        { title, body: body ?? '', head: branch, base: 'main' })
      prNumber = pr.number
    }

    const prUrl = `${baseUrl}/agent/workspace/pulls/${prNumber}`
    return this.pollForReview(baseUrl, token, prNumber, prUrl)
  }

  /** List open PRs on Forgejo */
  async listOpenPRs(): Promise<Array<{ number: number, title: string, branch: string, url: string }>> {
    const { baseUrl, token } = await this.ensureRemote()

    const prs = await forgejoApi<any[]>(baseUrl, token, 'GET',
      '/api/v1/repos/agent/workspace/pulls?state=open')

    return prs.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.head?.ref ?? '',
      url: `${baseUrl}/agent/workspace/pulls/${pr.number}`,
    }))
  }

  /** Forgejo web URL for PRs */
  get reviewUrl(): Promise<string> {
    return this.config.server.ensureRunning().then(({ url }) => `${url}/agent/workspace/pulls`)
  }

  // -- Internal -------------------------------------------------------------

  private async pollForReview(baseUrl: string, token: string, prNumber: number, prUrl: string): Promise<ReviewResult> {
    const interval = this.config.pollInterval ?? 2000

    // Snapshot existing reviews as "id:state" — detects both new reviews
    // and state changes (Forgejo reuses IDs when same user re-reviews)
    const seen = new Set<string>()
    const existing = await forgejoApi<any[]>(baseUrl, token, 'GET',
      `/api/v1/repos/agent/workspace/pulls/${prNumber}/reviews`)
    for (const r of existing)
      seen.add(`${r.id}:${r.state}`)

    while (true) {
      await sleep(interval)

      const reviews = await forgejoApi<any[]>(baseUrl, token, 'GET',
        `/api/v1/repos/agent/workspace/pulls/${prNumber}/reviews`)

      for (const review of reviews) {
        if (review.state === 'PENDING')
          continue
        if (seen.has(`${review.id}:${review.state}`))
          continue

        const comments: ReviewResult['comments'] = []
        if (review.comments_count > 0) {
          const rc = await forgejoApi<any[]>(baseUrl, token, 'GET',
            `/api/v1/repos/agent/workspace/pulls/${prNumber}/reviews/${review.id}/comments`)
          for (const c of rc)
            comments.push({ path: c.path ?? '', body: c.body ?? '', diffHunk: c.diff_hunk ?? '' })
        }

        return {
          approved: review.state === 'APPROVED',
          body: review.body ?? '',
          comments,
          pr: prNumber,
          url: prUrl,
        }
      }

      // PR closed = rejection
      const pr = await forgejoApi<any>(baseUrl, token, 'GET',
        `/api/v1/repos/agent/workspace/pulls/${prNumber}`)
      if (pr.state === 'closed')
        return { approved: false, body: 'PR was closed', comments: [], pr: prNumber, url: prUrl }
    }
  }
}

// -- Helpers ----------------------------------------------------------------

function extractToken(output: string): string {
  const match = output.match(/:\s*(\S+)\s*$/)
  if (!match)
    throw new Error(`Could not extract token from: ${output}`)
  return match[1]
}

async function findFreePort(): Promise<number> {
  const { createServer } = await import('node:net')
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const port = (srv.address() as any).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function waitForReady(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${baseUrl}/api/v1/version`)
      if (resp.ok)
        return
    }
    catch { /* not ready */ }
    await sleep(300)
  }
  throw new Error(`Forgejo did not become ready within ${timeoutMs}ms`)
}

async function forgejoApi<T = any>(baseUrl: string, token: string, method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text()
    throw new Error(`Forgejo API ${method} ${path}: ${resp.status} ${text}`)
  }
  if (resp.status === 204)
    return undefined as T
  return resp.json() as Promise<T>
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
