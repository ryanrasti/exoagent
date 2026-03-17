#!/usr/bin/env node
import { Daemon } from './daemon'
import { resolve } from 'node:path'

/**
 * Start exoagentd with pi's interactive TUI.
 *
 * Usage:
 *   npx tsx src/runtime/start.ts [repo-dir]
 */

async function main() {
  const repoDir = resolve(process.argv[2] ?? '.')

  console.log(`Starting exoagentd...`)
  console.log(`  repo: ${repoDir}`)

  const daemon = await Daemon.start({ repoDir })
  console.log(`  workspace: ${daemon.cloneDir}`)
  console.log()

  // Cleanup on exit
  const cleanup = async () => {
    await daemon.stop()
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)

  // Run pi's interactive TUI — Forgejo starts lazily on first review.propose()
  await daemon.pi.runInteractive()
  await daemon.stop()
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
