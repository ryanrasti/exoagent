#!/usr/bin/env node
import { Daemon } from './daemon'
import { runSecretsUI } from './secrets-ui'
import { resolve, join } from 'node:path'

/**
 * exoagentd — run exos.
 *
 * Usage:
 *   exoagentd [repo] [--run <exo>] [-- ...args]
 *   exoagentd [repo]                          Shorthand for --run spawn
 *   exoagentd [repo] --run spawn              Spawn default agent + attach
 *   exoagentd [repo] --run spawn -- --id foo  Spawn named agent + attach
 *   exoagentd [repo] --list                   List running agents
 *   exoagentd [repo] --attach <id>            Attach to running agent
 *   exoagentd [repo] --kill <id>              Kill an agent
 */

async function main() {
  const rawArgs = process.argv.slice(2)

  let repoDir = '.'
  let command = 'run'
  let target = 'spawn' // default exo
  const exoArgs: string[] = []

  // After --run <exo>, all remaining args go to the exo.
  // Known CLI flags (--attach, --list, --kill) are handled before that.
  let i = 0
  while (i < rawArgs.length) {
    const arg = rawArgs[i]
    if (arg === '--secrets') {
      command = 'secrets'
    }
    else if (arg === '--run') {
      command = 'run'
      target = rawArgs[++i]
      i++
      break
    }
    else if (arg === '--attach') {
      command = 'attach'
      target = rawArgs[++i]
    }
    else if (arg === '--list') {
      command = 'list'
    }
    else if (arg === '--kill') {
      command = 'kill'
      target = rawArgs[++i]
    }
    else if (arg === '--') {
      i++
      break
    }
    else if (!arg.startsWith('-')) {
      repoDir = arg
    }
    i++
  }
  // Everything after --run <exo> or -- goes to the exo
  while (i < rawArgs.length) {
    exoArgs.push(rawArgs[i++])
  }

  repoDir = resolve(repoDir)

  if (command === 'secrets') {
    await runSecretsUI(join(repoDir, '.exoagent'))
    return
  }

  const daemon = await Daemon.start({ repoDir })

  const cleanup = async () => {
    await daemon.stop()
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)

  if (command === 'list') {
    const agents = daemon.list()
    if (agents.length === 0) {
      console.log('No agents running.')
    }
    else {
      agents.forEach(a => console.log(a))
    }
    return
  }

  if (command === 'kill') {
    daemon.kill(target)
    console.log(`Killed: ${target}`)
    return
  }

  if (command === 'attach') {
    daemon.attach(target)
    return
  }

  // Run exo
  await daemon.runExo(target, exoArgs)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
