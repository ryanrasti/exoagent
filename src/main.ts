#!/usr/bin/env tsx
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import * as Cli from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { transform } from 'esbuild'
import { exoEval, exoImport } from './exoeval'
import { Capabilities as Caps } from './capabilities'

class TaskExecutor {
  private loadResult?: (caps: Caps) => void
  public promise?: Promise<unknown>

  constructor(
    public readonly name: string,
    public readonly code: string,
    public readonly task: string,
    public readonly caps: Caps,
  ) {}

  async load() {
    const mod = await exoImport(this.code)
    if (typeof mod.default !== 'function') {
      throw new TypeError('Task must export default a function')
    }
    this.loadResult = mod.default as (caps: Caps) => void
    return this.loadResult
  }

  execute() {
    const loadResult = this.loadResult
    if (loadResult == null) {
      throw new TypeError('Task must be loaded before execution')
    }
    this.promise = (async () => loadResult(this.caps))()
  }
}

// Re-export for backwards compatibility
export { Caps, Caps as Capabilities }

const TASKS_DIR = join(import.meta.dirname, 'tasks')

async function loadTasks(tasksDir = TASKS_DIR): Promise<Map<string, TaskExecutor>> {
  const tasks = new Map<string, TaskExecutor>()
  const entries = await readdir(tasksDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue
    const codePath = join(tasksDir, entry.name, 'index.ts')
    try {
      const raw = await readFile(codePath, 'utf-8')
      const { code } = await transform(raw, { loader: 'ts' })
      tasks.set(entry.name, new TaskExecutor(entry.name, code, entry.name, new Caps(entry.name)))
    }
    catch {
      // skip directories without index.ts
    }
  }
  return tasks
}

const runEval = (code: string) =>
  Effect.promise(async () => {
    const caps = new Caps('eval')
    const fn = exoEval(code) as (caps: Caps) => unknown | Promise<unknown>
    try {
      await Promise.resolve(fn(caps))
    }
    finally {
      try {
        await caps.close()
      }
      catch (err) {
        console.error(`error closing caps:`, err)
      }
    }
  })

const runTasks = (filter?: string) =>
  Effect.promise(async () => {
    const allTasks = await loadTasks()
    const tasks = filter ? new Map([...allTasks].filter(([name]) => name === filter)) : allTasks

    if (filter && tasks.size === 0) {
      console.error(`task not found: ${filter}`)
      console.error(`available: ${[...allTasks.keys()].join(', ')}`)
      throw new Error(`task not found: ${filter}`)
    }

    for (const executor of tasks.values()) {
      await executor.load()
    }
    // eslint-disable-next-line no-console
    console.log('running tasks:', [...tasks.keys()])

    for (const executor of tasks.values()) {
      executor.execute()
    }

    for (const [task, executor] of tasks.entries()) {
      try {
        await executor.promise
      }
      catch (err) {
        console.error(`task ${task} failed:`, err)
      }
    }

    for (const executor of tasks.values()) {
      await executor.caps.close()
    }

    // eslint-disable-next-line no-console
    console.log('done')
  })

const command = Cli.Command.make('exoagent', {
  eval: Cli.Options.text('eval').pipe(Cli.Options.optional),
  task: Cli.Options.text('task').pipe(Cli.Options.withAlias('t'), Cli.Options.optional),
  args: Cli.Args.text({ name: 'arg' }).pipe(Cli.Args.repeated),
}).pipe(
  Cli.Command.withDescription('Run exoagent tasks or eval code'),
  Cli.Command.withHandler(({ eval: evalOpt, task, args }) => {
    if (Option.isSome(evalOpt)) {
      return runEval(evalOpt.value)
    }

    // Support both -t/--task and positional argument for task name
    const taskName = Option.getOrElse(task, () => args[0])

    if (args.length > 1 || (Option.isSome(task) && args.length > 0)) {
      console.error('Unexpected extra arguments. Use -t <task> or pass task name as argument.')
      return Effect.fail(new Error('Too many arguments'))
    }

    return runTasks(taskName)
  }),
)

const cli = Cli.Command.run({
  name: 'exoagent',
  version: '0.0.1',
  executable: 'exoagent',
})(command)

// CLI drops first 2 when executable is set, then prefixes command name; pass only runtime + script + user args.
const argv = [process.argv[0], process.argv[1], ...process.argv.slice(process.argv[1]?.endsWith('.ts') ? 2 : 1)]
cli(argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
)
