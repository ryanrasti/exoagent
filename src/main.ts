#!/usr/bin/env tsx
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import * as Cli from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import * as Effect from 'effect/Effect'
import { transform } from 'esbuild'
import { z } from 'zod'
import { exoEval, exoImport } from './exoeval'
import { tool } from './exoeval/tool'
import { BrowserClient } from './plugins/browser'
import { MockGmailClient } from './plugins/gmail'
import { LlmClient } from './plugins/llm'

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

type Resource = {
  close: () => Promise<void>
}

export class Caps {
  private resources: Resource[] = []

  @tool()
  public readonly gmail = new MockGmailClient()

  @tool()
  public browser(): BrowserClient {
    return this.register(new BrowserClient())
  }

  @tool()
  public readonly llm = new LlmClient()

  constructor(public readonly task: string) {
    this.resources = []
  }

  register<T extends Resource>(resource: T): T {
    this.resources.push(resource)
    return resource
  }

  @tool(z.string())
  log(message: string) {
    // eslint-disable-next-line no-console
    console.log(message)
  }

  async close() {
    for (const resource of this.resources.reverse()) {
      try {
        await resource.close()
      }
      catch (err) {
        console.error(`error closing resource: ${resource}`, err)
      }
    }
  }
}

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
  eval: Cli.Options.text('eval'),
  args: Cli.Args.text({ name: 'arg' }).pipe(Cli.Args.repeated),
}).pipe(
  Cli.Command.withDescription('Run exoagent tasks or eval code'),
  Cli.Command.withHandler(({ eval: code, args }) => {
    if (code) {
      if (!code) {
        console.error('Usage: exoagent --eval "<code>"')
        return Effect.fail(new Error('Missing code for --eval'))
      }
      return runEval(code)
    }

    if (args.length > 1) {
      console.error('Unexpected extra arguments. Pass at most one task name.')
      return Effect.fail(new Error('Too many positional arguments'))
    }

    const [task] = args
    return runTasks(task)
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
