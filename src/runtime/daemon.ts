import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { StorageCap } from './providers/storage'
import { Secrets } from './providers/secrets'
import { ForgejoServer } from './providers/review'

/**
 * exoagentd — minimal runtime daemon.
 *
 * Owns shared infrastructure scoped to the daemon's lifetime:
 * - StorageCap (SQLite)
 * - Secrets (SQLite)
 * - ForgejoServer (singleton)
 *
 * Everything else (spawning agents, sandbox, review, pi) is
 * composed by the caller (init exo, CLI, etc.)
 */

export interface DaemonConfig {
  /** Path to the main project repo (source of truth) */
  repoDir: string
  /** Data directory for daemon state. Default: <repoDir>/.exoagent */
  dataDir?: string
}

export class Daemon {
  readonly repoDir: string
  readonly dataDir: string
  readonly storage: StorageCap
  readonly secrets: Secrets
  readonly forgejo: ForgejoServer

  private constructor(
    repoDir: string,
    dataDir: string,
    storage: StorageCap,
    secrets: Secrets,
    forgejo: ForgejoServer,
  ) {
    this.repoDir = repoDir
    this.dataDir = dataDir
    this.storage = storage
    this.secrets = secrets
    this.forgejo = forgejo
  }

  static async start(config: DaemonConfig): Promise<Daemon> {
    const repoDir = config.repoDir
    const dataDir = config.dataDir ?? join(repoDir, '.exoagent')

    await mkdir(dataDir, { recursive: true })

    const storage = new StorageCap(join(dataDir, 'storage.db'))
    const secrets = new Secrets(join(dataDir, 'secrets.db'))

    const forgejo = ForgejoServer.create({
      repoDir,
      dataDir: join(dataDir, 'forgejo'),
      nix: { forgejo: process.env.EXOAGENT_NIX_FORGEJO!, git: process.env.EXOAGENT_NIX_GIT! },
    })

    return new Daemon(repoDir, dataDir, storage, secrets, forgejo)
  }

  async stop(): Promise<void> {
    await this.forgejo.stop()
    ForgejoServer.reset()
  }
}
