#!/usr/bin/env node
import { spawnAgent } from './spawn'
import { StorageCap } from './providers/storage'
import { ForgejoServer } from './providers/review'
import { join } from 'node:path'

/**
 * Agent process — runs inside a pty managed by the daemon.
 *
 * Reads config from env vars set by the daemon:
 *   EXOAGENT_REPO_DIR, EXOAGENT_DATA_DIR, EXOAGENT_AGENT_ID
 */

async function main() {
  const repoDir = process.env.EXOAGENT_REPO_DIR
  const dataDir = process.env.EXOAGENT_DATA_DIR
  const agentId = process.env.EXOAGENT_AGENT_ID

  if (!repoDir || !dataDir || !agentId) {
    console.error('Missing EXOAGENT_REPO_DIR, EXOAGENT_DATA_DIR, or EXOAGENT_AGENT_ID')
    process.exit(1)
  }

  // Connect to shared infra (same DBs as daemon)
  const storage = new StorageCap(join(dataDir, 'storage.db'))
  const forgejo = ForgejoServer.create({
    repoDir,
    dataDir: join(dataDir, 'forgejo'),
    nix: { forgejo: process.env.EXOAGENT_NIX_FORGEJO!, git: process.env.EXOAGENT_NIX_GIT! },
  })

  const agent = await spawnAgent({
    id: agentId,
    repoDir,
    dataDir,
    storage,
    forgejo,
  })

  // Run interactive TUI (this blocks until user exits)
  await agent.pi.runInteractive()
  agent.pi.dispose()
}

main().catch((err) => {
  console.error('Agent error:', err)
  process.exit(1)
})
