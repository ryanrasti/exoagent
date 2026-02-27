#!/usr/bin/env tsx
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { transform } from 'esbuild'
import { z } from 'zod'
import { exoImport } from './exoeval'
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
    let loadResult = this.loadResult
    if (loadResult == null) {
      loadResult = this.load()
    }
    this.promise = (async () => loadResult(this.caps))()
  }
}

export class Caps {
  @tool()
  public readonly gmail = new MockGmailClient()

  @tool()
  public readonly browser = new BrowserClient()

  @tool()
  public readonly llm = new LlmClient()

  constructor(public readonly task: string) {}

  @tool(z.string())
  log(message: string) {
    // eslint-disable-next-line no-console
    console.log(message)
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

const main = async () => {
  const filter = process.argv[2]
  const allTasks = await loadTasks()

  const tasks = filter
    ? new Map([...allTasks].filter(([name]) => name === filter))
    : allTasks

  if (filter && tasks.size === 0) {
    console.error(`task not found: ${filter}`)
    console.error(`available: ${[...allTasks.keys()].join(', ')}`)
    process.exit(1)
  }

  for (const [task, executor] of tasks.entries()) {
    await executor.load()
  }
  // eslint-disable-next-line no-console
  console.log('running tasks:', [...tasks.keys()])

  for (const [task, executor] of tasks.entries()) {
    executor.execute()
  }

  // await all task promises
  for (const [task, executor] of tasks.entries()) {
    try {
      await executor.promise
    }
    catch (err) {
      console.error(`task ${task} failed:`, err)
    }
  }

  // cleanup
  for (const [, executor] of tasks.entries()) {
    await executor.caps.browser.close()
  }

  console.log('done')
}

main()
