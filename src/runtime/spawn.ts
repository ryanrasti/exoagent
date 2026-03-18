import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SandboxCap, nixPathsFromEnv } from './providers/sandbox'
import { StorageCap } from './providers/storage'
import { Secrets } from './providers/secrets'
import { ReviewCap } from './providers/review'
import { PiCap } from './providers/pi'
import { generateCapDts } from './dts'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Spawn a coding agent — wires sandbox + review + pi together.
 */

export interface SpawnConfig {
  id: string
  repoDir: string
  dataDir: string
  storage: StorageCap
  secrets?: Secrets
}

export interface Agent {
  readonly id: string
  readonly pi: PiCap
  readonly review: ReviewCap
  readonly cloneDir: string
}

export async function spawnAgent(config: SpawnConfig): Promise<Agent> {
  const { id, repoDir, dataDir, storage } = config
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

  // Review cap (GitHub-based)
  const review = new ReviewCap({
    cloneDir,
    git: gitPath,
    secrets: config.secrets,
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
