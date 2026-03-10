import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { tool } from '../exoeval/tool'
import { loadExo } from './exo'

// A simple @tool()-decorated capability
@tool()
class MockStorage {
  private data: Map<string, unknown> = new Map()

  @tool(z.string())
  async get(key: string) {
    return this.data.get(key) ?? null
  }

  @tool(z.string(), z.any())
  async set(key: string, value: unknown) {
    this.data.set(key, value)
  }
}

@tool()
class MockSandbox {
  public commands: string[] = []

  @tool(z.object({ command: z.string() }))
  async exec({ command }: { command: string }) {
    this.commands.push(command)
    return { stdout: `ran: ${command}`, stderr: '', exitCode: 0 }
  }
}

describe('loadExo', () => {
  it('loads an exo from source code via exoImport', async () => {
    const exo = await loadExo('test', `
      export default async (caps) => {
        await caps.storage.set("loaded", true)
      }
    `)
    expect(exo.name).toBe('test')
    expect(typeof exo.run).toBe('function')
  })

  it('rejects modules without a default export function', async () => {
    await expect(loadExo('bad', `
      export default 42
    `)).rejects.toThrow(/must export default a function/)
  })
})

describe('runExo', () => {
  it('passes caps to an exo loaded via exoImport', async () => {
    const storage = new MockStorage()
    const caps = { storage }

    const exo = await loadExo('test', `
      export default async ({ storage }) => {
        await storage.set("key", "value")
      }
    `)

    await exo.run(caps)
    expect(await storage.get('key')).toBe('value')
  })

  it('provides multiple caps', async () => {
    const storage = new MockStorage()
    const sandbox = new MockSandbox()
    const caps = { storage, sandbox }

    const exo = await loadExo('test', `
      export default async ({ storage, sandbox }) => {
        await storage.set("greeting", "hello")
        await sandbox.exec({ command: "echo hello" })
      }
    `)

    await exo.run(caps)
    expect(await storage.get('greeting')).toBe('hello')
    expect(sandbox.commands).toEqual(['echo hello'])
  })

  it('exo receives full cap set (destructure is audit trail)', async () => {
    const storage = new MockStorage()
    const sandbox = new MockSandbox()
    const caps = { storage, sandbox }

    // This exo only destructures storage — sandbox is in the caps
    // but not used. The destructure is the audit trail.
    const exo = await loadExo('test', `
      export default async ({ storage }) => {
        await storage.set("only-storage", true)
      }
    `)

    await exo.run(caps)
    expect(await storage.get('only-storage')).toBe(true)
    expect(sandbox.commands).toEqual([])
  })

  it('exo can return void (sync)', async () => {
    const exo = await loadExo('noop', `
      export default ({ }) => { }
    `)
    await exo.run({})
  })
})
