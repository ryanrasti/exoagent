#!/usr/bin/env node
import { join } from 'node:path'
import process from 'node:process'
import { spawnAgent } from './providers/pi'
import { Secrets } from './providers/secrets'
import { StorageCap } from './providers/storage'

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

  const storage = StorageCap.create(join(dataDir, 'storage'))
  const secrets = Secrets.create(join(dataDir, 'secrets'))

  const agent = await spawnAgent({
    id: agentId,
    repoDir,
    dataDir,
    storage,
    secrets,
  })

  await agent.pi.runInteractive()
  agent.pi.dispose()
}

main().catch((err) => {
  console.error('Agent error:', err)
  process.exit(1)
})
