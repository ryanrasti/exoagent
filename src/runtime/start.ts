#!/usr/bin/env node
import { join, resolve } from 'node:path'
import process from 'node:process'
import { Daemon } from './daemon'
import { runSecretsUI } from './secrets-ui'

/**
 * exoagentd — run exos.
 *
 * Usage:
 *   exoagentd                                 Spawn default agent + attach (cwd)
 *   exoagentd --repo /path/to/repo            Use a different repo
 *   exoagentd --run spawn --id foo            Spawn named agent + attach
 *   exoagentd --list                          List running agents
 *   exoagentd --attach <id>                   Attach to running agent
 *   exoagentd --kill <id>                     Kill an agent
 *   exoagentd --secrets                       Manage secrets
 *   exoagentd --eval '({review}) => review.getReviews({pr:1})'
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
    else if (arg === '--eval') {
      command = 'eval'
      target = rawArgs[++i]
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
    else if (arg === '--repo') {
      repoDir = rawArgs[++i]
    }
    else if (arg === '--') {
      i++
      break
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

  if (command === 'eval') {
    if (!target) { console.error('Usage: --eval <code>'); process.exit(1) }
    const result = await daemon.evalCode(target)
    if (result !== undefined) { console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2)) }
    return
  }

  // Run exo
  await daemon.runExo(target, exoArgs)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
