import { describe, expect, it } from 'vitest'
import z from 'zod'
import type { CodeModeResult } from './code-mode'
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

/** Create a builtin toolset with respond and setToolCallResult */
function createBuiltinToolset(exoAgent: ExoAgent<any, any>, callbacks: { onRespond?: (msg: string) => void, onSetResult?: (result: unknown) => void } = {}) {
  return new class {
    @exoAgent.tool(z.string())
    respond(msg: string) {
      callbacks.onRespond?.(msg)
    }

    @exoAgent.tool(z.unknown())
    setToolCallResult(result: unknown) {
      callbacks.onSetResult?.(result)
    }
  }()
}

describe('codeMode (REPL style)', () => {
  it('executes code with globals', async () => {
    let response = ''
    let data: unknown = null

    const wrappedTool = codeMode({
      globals: {
        api: new TestToolset(),
        builtin: createBuiltinToolset(exo, { onRespond: (msg) => { response = msg }, onSetResult: (result) => { data = result } }),
      },
      policy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `
        const addResult = api.add({ a: 10, b: 5 })
        builtin.respond("Added numbers")
        builtin.setToolCallResult({ result: addResult })
      `,
    })

    expect(result.error).toBeUndefined()
    expect(response).toBe('Added numbers')
    expect(data).toEqual({ result: 15 })
    expect(result.taints).toEqual([])
  })

  it('executes code that chains tools', async () => {
    let response = ''
    let data: unknown = null

    const wrappedTool = codeMode({
      globals: {
        api: new TestToolset(),
        builtin: createBuiltinToolset(exo, { onRespond: (msg) => { response = msg }, onSetResult: (result) => { data = result } }),
      },
      policy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `
        const value = api.subtract({ a: 20, b: 8 })
        builtin.respond("Subtracted")
        builtin.setToolCallResult(value)
      `,
    })

    expect(result.error).toBeUndefined()
    expect(response).toBe('Subtracted')
    expect(data).toEqual(12)
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
    let data: unknown = null

    const wrappedTool = codeMode({
      globals: {
        api: new AsyncToolset(),
        builtin: createBuiltinToolset(asyncExo, { onSetResult: (result) => { data = result } }),
      },
      policy: asyncPolicy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `
        const doubled = await api.asyncDouble(21)
        builtin.setToolCallResult(doubled)
      `,
    })

    expect(result.error).toBeUndefined()
    expect(data).toBe(42)
  })

  it('handles multiple sequential async calls', async () => {
    let data: unknown = null

    const wrappedTool = codeMode({
      globals: {
        api: new AsyncToolset(),
        builtin: createBuiltinToolset(asyncExo, { onSetResult: (result) => { data = result } }),
      },
      policy: asyncPolicy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `
        const a = await api.asyncDouble(5)
        const b = await api.asyncDouble(a)
        builtin.setToolCallResult(b)
      `,
    })

    expect(result.error).toBeUndefined()
    expect(data).toBe(20)
  })

  it('handles async calls in expressions', async () => {
    let data: unknown = null

    const wrappedTool = codeMode({
      globals: {
        api: new AsyncToolset(),
        builtin: createBuiltinToolset(asyncExo, { onSetResult: (result) => { data = result } }),
      },
      policy: asyncPolicy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `
        const sum = await api.asyncAdd(await api.asyncDouble(3), await api.asyncDouble(4))
        builtin.setToolCallResult(sum)
      `,
    })

    expect(result.error).toBeUndefined()
    expect(data).toBe(14) // (3*2) + (4*2) = 6 + 8 = 14
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
    const wrappedTool = codeMode({
      globals: {
        api: new ErrorToolset(),
        builtin: createBuiltinToolset(errorExo),
      },
      policy: errorPolicy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `api.throwError("test error")`,
    })

    expect(result.error).toBeDefined()
    expect(result.error?.message).toBe('test error')
  })

  it('propagates validation errors from tools', async () => {
    const wrappedTool = codeMode({
      globals: {
        api: new ErrorToolset(),
        builtin: createBuiltinToolset(errorExo),
      },
      policy: errorPolicy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `api.validatePositive(-5)`,
    })

    expect(result.error).toBeDefined()
    expect(result.error?.message).toBe('Number must be positive')
  })

  it('handles syntax errors in user code', async () => {
    const wrappedTool = codeMode({
      globals: {
        api: new ErrorToolset(),
        builtin: createBuiltinToolset(errorExo),
      },
      policy: errorPolicy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `this is not valid javascript`,
    })

    expect(result.error).toBeDefined()
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
    let response = ''
    const denyPolicy = policyExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ])

    const wrappedTool = codeMode({
      globals: {
        api: new PolicyToolset(),
        builtin: createBuiltinToolset(policyExo, { onRespond: (msg) => { response = msg } }),
      },
      policy: denyPolicy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `
        const trusted = api.getTrusted()
        const written = api.writeSensitive(trusted)
        builtin.respond(written)
      `,
    })

    expect(result.error).toBeUndefined()
    expect(response).toBe('wrote: trusted data')
  })

  it('denies untrusted data flow to sensitive sink', async () => {
    const denyPolicy = policyExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ])

    const wrappedTool = codeMode({
      globals: {
        api: new PolicyToolset(),
        builtin: createBuiltinToolset(policyExo),
      },
      policy: denyPolicy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `
        const untrusted = api.getUntrusted()
        api.writeSensitive(untrusted)
      `,
    })

    expect(result.error).toBeDefined()
    expect(result.error?.message).toMatch(/Method call denied/)
  })

  it('denies untrusted data even through transformations', async () => {
    const denyPolicy = policyExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ])

    const wrappedTool = codeMode({
      globals: {
        api: new PolicyToolset(),
        builtin: createBuiltinToolset(policyExo),
      },
      policy: denyPolicy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `
        const untrusted = api.getUntrusted()
        const transformed = api.transform(untrusted)
        api.writeSensitive(transformed)
      `,
    })

    expect(result.error).toBeDefined()
    expect(result.error?.message).toMatch(/Method call denied/)
  })
})

describe('codeMode - tool description and schema', () => {
  it('has description with API documentation', () => {
    const tool = codeMode({
      globals: { api: new TestToolset(), builtin: createBuiltinToolset(exo) },
      policy,
      dts: 'interface Api { add(a: number, b: number): number }',
      outputSink: 'output',
      inputTaints: [],
    })
    expect(tool.description).toContain('interface Api')
    expect(tool.description).toContain('add')
  })

  it('has input schema requiring code parameter', () => {
    const tool = codeMode({
      globals: { api: new TestToolset(), builtin: createBuiltinToolset(exo) },
      policy,
      outputSink: 'output',
      inputTaints: [],
    })
    expect(tool.inputSchema).toBeDefined()

    // Validate that the schema requires 'code'
    const parseResult = tool.inputSchema.safeParse({ code: 'builtin.respond("hi")' })
    expect(parseResult.success).toBe(true)

    const invalidResult = tool.inputSchema.safeParse({})
    expect(invalidResult.success).toBe(false)
  })
})

describe('codeMode - taint tracking', () => {
  it('captures taints from tool results', async () => {
    const taintExo = new ExoAgent(['source'] as const, ['output'] as const)
    const taintPolicy = taintExo.policy([])

    class TaintToolset {
      @taintExo.tool({ source: ['source'] })
      getTainted() { return 'tainted data' }
    }

    let data: unknown = null

    const wrappedTool = codeMode({
      globals: {
        api: new TaintToolset(),
        builtin: createBuiltinToolset(taintExo, { onSetResult: (result) => { data = result } }),
      },
      policy: taintPolicy,
      outputSink: 'output',
      inputTaints: [],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `
        const tainted = api.getTainted()
        builtin.setToolCallResult(tainted)
      `,
    })

    expect(result.error).toBeUndefined()
    expect(data).toBe('tainted data')
    expect(result.taints).toContainEqual(['source', {}])
  })
})

describe('codeMode - ambient taints', () => {
  it('applies inputTaints to all egress calls', async () => {
    const ambientExo = new ExoAgent(['ambient'] as const, ['sink'] as const)
    const ambientPolicy = ambientExo.policy([
      { sources: ['ambient'], sinks: ['sink'] },
    ])

    class AmbientToolset {
      @ambientExo.tool(z.string(), { sink: ['sink'] })
      sendToSink(data: string) { return `sent: ${data}` }
    }

    const wrappedTool = codeMode({
      globals: {
        api: new AmbientToolset(),
        builtin: createBuiltinToolset(ambientExo),
      },
      policy: ambientPolicy,
      outputSink: 'sink',
      // LLM has seen ambient-tainted data in previous turns
      inputTaints: [['ambient', {}]],
    })

    // Even though the code uses a literal string (laundered data),
    // the ambient taints should still apply and block the call
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `api.sendToSink("laundered literal string")`,
    })

    expect(result.error).toBeDefined()
    expect(result.error?.message).toMatch(/Method call denied/)
  })

  it('allows calls when no deny rule matches ambient taints', async () => {
    const ambientExo = new ExoAgent(['safe'] as const, ['sink'] as const)
    const ambientPolicy = ambientExo.policy([
      // Only deny 'dangerous' -> 'sink', not 'safe' -> 'sink'
      { sources: ['dangerous'], sinks: ['sink'] },
    ])

    class AmbientToolset {
      @ambientExo.tool(z.string(), { sink: ['sink'] })
      sendToSink(data: string) { return `sent: ${data}` }
    }

    let response = ''
    const wrappedTool = codeMode({
      globals: {
        api: new AmbientToolset(),
        builtin: createBuiltinToolset(ambientExo, { onRespond: (msg) => { response = msg } }),
      },
      policy: ambientPolicy,
      outputSink: 'sink',
      // LLM has seen 'safe' tainted data - this shouldn't be blocked
      inputTaints: [['safe', {}]],
    })

    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<CodeModeResult>)({
      code: `
        const result = api.sendToSink("some data")
        builtin.respond(result)
      `,
    })

    expect(result.error).toBeUndefined()
    expect(response).toBe('sent: some data')
  })
})
