import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))

import { generateCapDts } from './dts'
import { SandboxCap, nixPathsFromEnv } from './providers/sandbox'
import { StorageCap } from './providers/storage'
import { Secrets } from './providers/secrets'
import { ForgejoServer, ReviewCap } from './providers/review'
import { PiCap } from './providers/pi'

/**
 * exoagentd — the runtime daemon.
 *
 * Wires together: Forgejo, sandbox, storage, secrets, review, pi.
 *
 * Usage:
 *   const daemon = await Daemon.start({ repoDir: '/path/to/project' })
 *   await daemon.pi.prompt("do something")  // background
 *   await daemon.pi.init()                  // interactive
 *   await daemon.stop()
 */

export interface DaemonConfig {
  /** Path to the main project repo (source of truth) */
  repoDir: string
  /** Data directory for daemon state. Default: <repoDir>/.exoagent */
  dataDir?: string
  /** Agent session ID. Default: random */
  agentId?: string
}

export class Daemon {
  readonly pi: PiCap
  readonly review: ReviewCap
  readonly cloneDir: string

  /** @internal — exposed for testing */
  readonly server: ForgejoServer

  private constructor(
    pi: PiCap,
    review: ReviewCap,
    server: ForgejoServer,
    cloneDir: string,
  ) {
    this.pi = pi
    this.review = review
    this.server = server
    this.cloneDir = cloneDir
  }

  static async start(config: DaemonConfig): Promise<Daemon> {
    const repoDir = config.repoDir
    const dataDir = config.dataDir ?? join(repoDir, '.exoagent')
    const agentId = config.agentId ?? `agent-${randomBytes(4).toString('hex')}`
    const nix = nixPathsFromEnv()
    const gitPath = process.env.EXOAGENT_NIX_GIT!
    const git = join(gitPath, 'bin', 'git')

    await mkdir(dataDir, { recursive: true })

    // Storage + secrets
    const storage = new StorageCap(join(dataDir, 'storage.db'))
    const secrets = new Secrets(join(dataDir, 'secrets.db'))

    // Local clone as workspace (reuse if already exists)
    const clonesDir = join(dataDir, 'clones')
    await mkdir(clonesDir, { recursive: true })
    const cloneDir = join(clonesDir, agentId)
    try {
      execFileSync(git, ['rev-parse', '--git-dir'], { cwd: cloneDir })
      // Already a git repo — pull latest main
      execFileSync(git, ['fetch', 'origin'], { cwd: cloneDir, timeout: 30000 })
    }
    catch {
      execFileSync(git, ['clone', '--local', repoDir, cloneDir])
    }
    execFileSync(git, ['-C', cloneDir, 'config', 'user.name', 'agent'])
    execFileSync(git, ['-C', cloneDir, 'config', 'user.email', 'agent@localhost'])

    // Forgejo server (singleton, lazy-started)
    const server = ForgejoServer.create({
      repoDir,
      dataDir: join(dataDir, 'forgejo'),
      nix: { forgejo: process.env.EXOAGENT_NIX_FORGEJO!, git: gitPath },
    })

    // Sandbox (workspace = the clone)
    const sandbox = new SandboxCap({
      nix,
      storage,
      sessionId: agentId,
      workspace: cloneDir,
    })

    // Review cap (pushes from clone to Forgejo)
    const review = new ReviewCap({
      server,
      cloneDir,
      git: gitPath,
    })

    // Generate .d.ts for caps so codemode gets proper types
    const reviewDts = generateCapDts(
      join(__dirname, 'providers', 'review.ts'),
      'ReviewCap',
    )
    const capsDts = `declare const review: ${reviewDts}`

    // Pi (coding agent with sandbox + review cap)
    const pi = new PiCap({
      sandbox,
      caps: { review },
      capsDts,
    })

    return new Daemon(pi, review, server, cloneDir)
  }

  /** Forgejo web URL for viewing PRs */
  get reviewUrl(): Promise<string> {
    return this.review.reviewUrl
  }

  /** Clean up: stop pi, stop forgejo */
  async stop(): Promise<void> {
    this.pi.dispose()
    await this.server.stop()
    ForgejoServer.reset()
  }
}
