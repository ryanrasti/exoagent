#!/usr/bin/env tsx
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { transform } from 'esbuild'
import { z } from 'zod'
import { exoImport } from './exoeval'
import { tool } from './exoeval/tool'
import { MockGmailClient } from './plugins/gmail'

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
  const tasks = await loadTasks()
  for (const [task, executor] of tasks.entries()) {
    await executor.load()
  }
  // eslint-disable-next-line no-console
  console.log('loaded tasks:', [...tasks.keys()])

  for (const [task, executor] of tasks.entries()) {
    executor.execute()
  }

  console.log('executed tasks:', [...tasks.keys()])
}

main()
