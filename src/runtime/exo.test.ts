import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { tool } from '../exoeval/tool'
import { StubProvider } from './dev'
import { ExoRunner } from './exo'

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

describe('ExoRunner', () => {
  it('passes caps to an exo', async () => {
    const storage = new MockStorage()
    const runner = new ExoRunner()
    runner.use('storage', new StubProvider('storage', storage))

    const exo = {
      name: 'test',
      path: 'test.ts',
      run: async ({ storage: s }: Record<string, any>) => {
        await s.set('key', 'value')
        const val = await s.get('key')
        expect(val).toBe('value')
      },
    }

    await runner.run(exo)
  })

  it('provides multiple caps to an exo', async () => {
    const storage = new MockStorage()
    const sandbox = new MockSandbox()

    const runner = new ExoRunner()
    runner.use('storage', new StubProvider('storage', storage))
    runner.use('sandbox', new StubProvider('sandbox', sandbox))

    const exo = {
      name: 'test',
      path: 'test.ts',
      run: async ({ storage: s, sandbox: sb }: Record<string, any>) => {
        await s.set('greeting', 'hello')
        await sb.exec({ command: 'echo hello' })
        expect(await s.get('greeting')).toBe('hello')
        expect(sb.commands).toEqual(['echo hello'])
      },
    }

    await runner.run(exo)
  })

  it('exo only sees caps it destructures', async () => {
    const storage = new MockStorage()
    const sandbox = new MockSandbox()

    const runner = new ExoRunner()
    runner.use('storage', new StubProvider('storage', storage))
    runner.use('sandbox', new StubProvider('sandbox', sandbox))

    // This exo only destructures storage — sandbox is in the caps
    // object but the exo doesn't use it. When exoeval is wired in,
    // the interpreter will enforce that sandbox is inaccessible.
    const exo = {
      name: 'test',
      path: 'test.ts',
      run: async ({ storage: s }: Record<string, any>) => {
        await s.set('only-storage', true)
        expect(await s.get('only-storage')).toBe(true)
      },
    }

    await runner.run(exo)
  })

  it('closes providers in reverse order', async () => {
    const order: string[] = []

    const p1 = {
      name: 'first',
      capabilities: () => ({}),
      close: async () => { order.push('first') },
    }
    const p2 = {
      name: 'second',
      capabilities: () => ({}),
      close: async () => { order.push('second') },
    }

    const runner = new ExoRunner()
    runner.use('first', p1)
    runner.use('second', p2)

    await runner.close()
    expect(order).toEqual(['second', 'first'])
  })
})
