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

const AGENT_SYSTEM_PROMPT = `
## Code Review Workflow

You have a \`codemode\` tool with access to a \`review\` API for GitHub PR-based code review.

When asked to make changes that should be reviewed:

1. Create a branch: \`git checkout -b <descriptive-branch-name>\`
2. Make your changes (edit files, run tests, etc.)
3. Commit: \`git add -A && git commit -m "<message>"\`
4. Open a PR: \`review.openPR({ branch: "<branch>", title: "<title>", body: "<description>" })\`
5. Tell the user the PR URL so they can review it on GitHub
6. Wait for review: \`review.waitForReview({ pr: <number>, sha: "<sha>" })\` (use the pr and sha from openPR)
7. If approved, you're done. If changes requested, address the feedback, commit, and call openPR again.

Important:
- Always use the sha returned by openPR when calling waitForReview
- The PR URL is a real GitHub URL — tell the user so they can review in their browser
- You can open multiple PRs for different changes (use different branch names)
- After calling waitForReview, it will block until the user submits a review on GitHub
`.trim()

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
    // Clone from local repo (fast, hardlinks objects)
    execFileSync(git, ['clone', '--local', repoDir, cloneDir])

    // Point origin to the real remote so push/fetch go to GitHub
    try {
      const remoteUrl = execFileSync(git, ['remote', 'get-url', 'origin'], {
        cwd: repoDir, encoding: 'utf-8',
      }).trim()
      execFileSync(git, ['-C', cloneDir, 'remote', 'set-url', 'origin', remoteUrl])
    }
    catch {
      // Main repo has no remote — keep local origin
    }
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
    systemPrompt: AGENT_SYSTEM_PROMPT,
  })

  return { id, pi, review, cloneDir }
}
