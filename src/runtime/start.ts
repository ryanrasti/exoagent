#!/usr/bin/env node
import { Daemon } from './daemon'
import { spawnAgent, type Agent } from './spawn'
import { resolve } from 'node:path'

/**
 * exoagentd CLI — init exo.
 *
 * Starts the daemon, spawns an agent, and attaches the TUI.
 *
 * Usage:
 *   exoagentd [repo-dir]                     Spawn + attach default agent
 *   exoagentd [repo-dir] --agent <name>      Spawn/reuse named agent
 */

async function main() {
  const args = process.argv.slice(2)

  let repoDir = '.'
  let agentId = 'default'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && args[i + 1])
      agentId = args[++i]
    else if (!args[i].startsWith('-'))
      repoDir = args[i]
  }

  repoDir = resolve(repoDir)
  console.log(`exoagentd — repo: ${repoDir}`)

  // Start daemon (shared infra)
  const daemon = await Daemon.start({ repoDir })

  // Spawn agent (wires sandbox + review + pi)
  const agent = await spawnAgent({
    id: agentId,
    repoDir,
    dataDir: daemon.dataDir,
    storage: daemon.storage,
    forgejo: daemon.forgejo,
  })

  console.log(`  agent: ${agent.id}`)
  console.log(`  workspace: ${agent.cloneDir}`)
  console.log()

  const cleanup = async () => {
    agent.pi.dispose()
    await daemon.stop()
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)

  // Run pi's interactive TUI
  await agent.pi.runInteractive()
  agent.pi.dispose()
  await daemon.stop()
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
