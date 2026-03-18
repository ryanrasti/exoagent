import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SandboxCap, nixPathsFromEnv } from './providers/sandbox'
import { StorageCap } from './providers/storage'
import { ForgejoServer, ReviewCap } from './providers/review'
import { PiCap } from './providers/pi'
import { generateCapDts } from './dts'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Spawn a coding agent — wires sandbox + review + pi together.
 *
 * This is the "coding agent" composition: given shared infra (storage,
 * forgejo), creates a sandboxed pi session with review capabilities.
 */

export interface SpawnConfig {
  /** Agent session ID */
  id: string
  /** Path to the main project repo */
  repoDir: string
  /** Base data directory (e.g. .exoagent) */
  dataDir: string
  /** Shared storage cap */
  storage: StorageCap
  /** Shared forgejo server */
  forgejo: ForgejoServer
}

export interface Agent {
  readonly id: string
  readonly pi: PiCap
  readonly review: ReviewCap
  readonly cloneDir: string
}

export async function spawnAgent(config: SpawnConfig): Promise<Agent> {
  const { id, repoDir, dataDir, storage, forgejo } = config
  const nix = nixPathsFromEnv()
  const gitPath = process.env.EXOAGENT_NIX_GIT!
  const git = join(gitPath, 'bin', 'git')

  // Create local clone
  const clonesDir = join(dataDir, 'clones')
  await mkdir(clonesDir, { recursive: true })
  const cloneDir = join(clonesDir, id)
  try {
    execFileSync(git, ['rev-parse', '--git-dir'], { cwd: cloneDir })
    execFileSync(git, ['fetch', 'origin'], { cwd: cloneDir, timeout: 30000 })
  }
  catch {
    execFileSync(git, ['clone', '--local', repoDir, cloneDir])
  }
  execFileSync(git, ['-C', cloneDir, 'config', 'user.name', 'agent'])
  execFileSync(git, ['-C', cloneDir, 'config', 'user.email', 'agent@localhost'])

  // Sandbox (workspace = the clone)
  const sandbox = new SandboxCap({
    nix,
    storage,
    sessionId: id,
    workspace: cloneDir,
  })

  // Review cap
  const review = new ReviewCap({
    server: forgejo,
    cloneDir,
    git: gitPath,
  })

  // Generate types for caps
  const reviewDts = generateCapDts(join(__dirname, 'providers', 'review.ts'), 'ReviewCap')
  const capsDts = `declare const review: ${reviewDts}`

  // Pi (coding agent with sandbox + review)
  const pi = new PiCap({
    sandbox,
    caps: { review },
    capsDts,
  })

  return { id, pi, review, cloneDir }
}
