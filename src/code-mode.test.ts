import { describe, expect, it } from 'vitest'
import z from 'zod'
import { codeMode } from './code-mode'
import { ExoAgent } from './policy'

const exo = new ExoAgent([], ['output'] as const)
const policy = exo.policy([])

class TestToolset {
  @exo.tool(z.object({ a: z.number(), b: z.number() }))
  add({ a, b }: { a: number, b: number }) {
    return a + b
  }

  @exo.tool(z.object({ a: z.number(), b: z.number() }))
  subtract({ a, b }: { a: number, b: number }) {
    return a - b
  }
}

describe('codeMode (capnweb-eval)', () => {
  it('executes user code that calls RpcToolset tools', async () => {
    const wrappedTool = codeMode({ api: new TestToolset(), policy, outputSink: 'output' })
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const toolset = await api
        const addResult = api.add({ a: 10, b: 5 })
        return { result: addResult }
      }`,
    })

    expect(result).toEqual({ result: 15 })
  })

  it('executes user code that chains RpcToolset tools', async () => {
    const wrappedTool = codeMode({ api: new TestToolset(), policy, outputSink: 'output' })
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        return api.subtract({ a: 20, b: 8 })
      }`,
    })

    expect(result).toEqual(12)
  })
})

describe('codeMode - async execution', () => {
  const asyncExo = new ExoAgent([], ['output'] as const)
  const asyncPolicy = asyncExo.policy([])

  class AsyncToolset {
    @asyncExo.tool(z.number())
    async asyncDouble(n: number): Promise<number> {
      return n * 2
    }

    @asyncExo.tool(z.number())
    async asyncDelay(ms: number): Promise<string> {
      return `waited ${ms}ms`
    }

    @asyncExo.tool(z.number(), z.number())
    async asyncAdd(a: number, b: number): Promise<number> {
      return a + b
    }
  }

  it('handles async tool calls with await', async () => {
    const wrappedTool = codeMode({ api: new AsyncToolset(), policy: asyncPolicy, outputSink: 'output' })
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const doubled = await api.asyncDouble(21)
        return doubled
      }`,
    })

    expect(result).toBe(42)
  })

  it('handles multiple sequential async calls', async () => {
    const wrappedTool = codeMode({ api: new AsyncToolset(), policy: asyncPolicy, outputSink: 'output' })
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const a = await api.asyncDouble(5)
        const b = await api.asyncDouble(a)
        return b
      }`,
    })

    expect(result).toBe(20)
  })

  it('handles async calls in expressions', async () => {
    const wrappedTool = codeMode({ api: new AsyncToolset(), policy: asyncPolicy, outputSink: 'output' })
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        return await api.asyncAdd(await api.asyncDouble(3), await api.asyncDouble(4))
      }`,
    })

    expect(result).toBe(14) // (3*2) + (4*2) = 6 + 8 = 14
  })
})

describe('codeMode - error propagation', () => {
  const errorExo = new ExoAgent([], ['output'] as const)
  const errorPolicy = errorExo.policy([])

  class ErrorToolset {
    @errorExo.tool(z.string())
    throwError(message: string): never {
      throw new Error(message)
    }

    @errorExo.tool(z.number())
    validatePositive(n: number): number {
      if (n < 0) throw new Error('Number must be positive')
      return n
    }
  }

  it('propagates errors from tool calls', async () => {
    const wrappedTool = codeMode({ api: new ErrorToolset(), policy: errorPolicy, outputSink: 'output' })
    await expect((wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => api.throwError("test error")`,
    })).rejects.toThrow('test error')
  })

  it('propagates validation errors from tools', async () => {
    const wrappedTool = codeMode({ api: new ErrorToolset(), policy: errorPolicy, outputSink: 'output' })
    await expect((wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => api.validatePositive(-5)`,
    })).rejects.toThrow('Number must be positive')
  })

  it('handles syntax errors in user code', async () => {
    const wrappedTool = codeMode({ api: new ErrorToolset(), policy: errorPolicy, outputSink: 'output' })
    await expect((wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => { this is not valid javascript }`,
    })).rejects.toThrow()
  })
})

describe('codeMode - nested object access', () => {
  const nestedExo = new ExoAgent([], ['output'] as const)
  const nestedPolicy = nestedExo.policy([])

  class OuterToolset {
    inner = new InnerToolset()

    @nestedExo.tool()
    getInner() {
      return this.inner
    }
  }

  class InnerToolset {
    @nestedExo.tool(z.number())
    process(n: number) {
      return n * 10
    }
  }

  it('accesses nested toolset via getter method', async () => {
    const wrappedTool = codeMode({ api: new OuterToolset(), policy: nestedPolicy, outputSink: 'output' })
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => {
        const inner = api.getInner()
        return inner.process(5)
      }`,
    })

    expect(result).toBe(50)
  })
})

describe('codeMode - complex return types', () => {
  const complexExo = new ExoAgent([], ['output'] as const)
  const complexPolicy = complexExo.policy([])

  class ComplexToolset {
    @complexExo.tool()
    getNestedObject() {
      return {
        level1: {
          level2: {
            value: 'deep',
          },
        },
        array: [1, 2, 3],
      }
    }

    @complexExo.tool()
    getArrayOfObjects() {
      return [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]
    }

    @complexExo.tool(z.array(z.object({ id: z.number(), name: z.string() })))
    processUsers(users: Array<{ id: number, name: string }>) {
      return users.map(u => ({ ...u, processed: true }))
    }
  }

  it('returns deeply nested objects', async () => {
    const wrappedTool = codeMode({ api: new ComplexToolset(), policy: complexPolicy, outputSink: 'output' })
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => api.getNestedObject()`,
    })

    expect(result).toEqual({
      level1: {
        level2: {
          value: 'deep',
        },
      },
      array: [1, 2, 3],
    })
  })

  it('returns arrays of objects', async () => {
    const wrappedTool = codeMode({ api: new ComplexToolset(), policy: complexPolicy, outputSink: 'output' })
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => api.getArrayOfObjects()`,
    })

    expect(result).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ])
  })

  it('handles complex data flow through tools', async () => {
    const wrappedTool = codeMode({ api: new ComplexToolset(), policy: complexPolicy, outputSink: 'output' })
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => {
        const users = api.getArrayOfObjects()
        return api.processUsers(users)
      }`,
    })

    expect(result).toEqual([
      { id: 1, name: 'Alice', processed: true },
      { id: 2, name: 'Bob', processed: true },
    ])
  })

  it('constructs and returns complex objects', async () => {
    const wrappedTool = codeMode({ api: new ComplexToolset(), policy: complexPolicy, outputSink: 'output' })
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => {
        const nested = api.getNestedObject()
        const users = api.getArrayOfObjects()
        return {
          nestedValue: nested,
          userCount: 2,
          users: users
        }
      }`,
    })

    expect(result).toEqual({
      nestedValue: {
        level1: { level2: { value: 'deep' } },
        array: [1, 2, 3],
      },
      userCount: 2,
      users: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    })
  })
})

describe('codeMode - policy enforcement', () => {
  const policyExo = new ExoAgent(
    ['untrusted', 'trusted'] as const,
    ['sensitive', 'output'] as const,
  )

  class PolicyToolset {
    @policyExo.tool({ source: ['untrusted'] })
    getUntrusted() { return 'untrusted data' }

    @policyExo.tool({ source: ['trusted'] })
    getTrusted() { return 'trusted data' }

    @policyExo.tool(z.string(), { sink: ['sensitive'] })
    writeSensitive(data: string) { return `wrote: ${data}` }

    @policyExo.tool(z.string())
    transform(data: string) { return `transformed: ${data}` }
  }

  it('allows trusted data flow to sensitive sink', async () => {
    const denyPolicy = policyExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ])
    const wrappedTool = codeMode({ api: new PolicyToolset(), policy: denyPolicy, outputSink: 'output' })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => {
        const trusted = api.getTrusted()
        return api.writeSensitive(trusted)
      }`,
    })

    expect(result).toBe('wrote: trusted data')
  })

  it('denies untrusted data flow to sensitive sink', async () => {
    const denyPolicy = policyExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ])
    const wrappedTool = codeMode({ api: new PolicyToolset(), policy: denyPolicy, outputSink: 'output' })

    await expect((wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => {
        const untrusted = api.getUntrusted()
        return api.writeSensitive(untrusted)
      }`,
    })).rejects.toThrow(/Method call denied/)
  })

  it('denies untrusted data even through transformations', async () => {
    const denyPolicy = policyExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ])
    const wrappedTool = codeMode({ api: new PolicyToolset(), policy: denyPolicy, outputSink: 'output' })

    await expect((wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `(api) => {
        const untrusted = api.getUntrusted()
        const transformed = api.transform(untrusted)
        return api.writeSensitive(transformed)
      }`,
    })).rejects.toThrow(/Method call denied/)
  })
})

describe('codeMode - tool description and schema', () => {
  it('has description with API documentation', () => {
    const tool = codeMode({ api: new TestToolset(), policy, dts: 'interface Api { add(a: number, b: number): number }', outputSink: 'output' })
    expect(tool.description).toContain('interface Api')
    expect(tool.description).toContain('add')
  })

  it('has input schema requiring code parameter', () => {
    const tool = codeMode({ api: new TestToolset(), policy, outputSink: 'output' })
    expect(tool.inputSchema).toBeDefined()

    // Validate that the schema requires 'code'
    const parseResult = tool.inputSchema.safeParse({ code: '(api) => 42' })
    expect(parseResult.success).toBe(true)

    const invalidResult = tool.inputSchema.safeParse({})
    expect(invalidResult.success).toBe(false)
  })
})
