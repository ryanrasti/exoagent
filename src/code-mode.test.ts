import type { Tool } from 'ai'
import { readFile } from 'node:fs/promises'
import { jsonSchema } from 'ai'
import { describe, expect, it } from 'vitest'
import { CodeMode } from './code-mode.js'
import { TestToolset } from './rpc-toolset-test-helpers'

describe('codeMode (capnweb-eval)', () => {
  // capnweb-eval does not support try/catch/finally; omit those tests. async/await is supported.
  const codeModeCapnwebEval = new CodeMode({ kind: 'capnweb-eval__EXPERIMENTAL' })

  it('executes user code that calls tools', async () => {
    const tools: Tool[] = [
      {
        description: 'Adds two numbers',
        inputSchema: jsonSchema({ type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] }),
        execute: async ({ a, b }: { a: number, b: number }) => ({ result: a + b }),
      },
      {
        description: 'Greets a person',
        inputSchema: jsonSchema({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }),
        execute: async ({ name }: { name: string }) => ({ message: `Hello, ${name}!` }),
      },
    ]

    const wrappedTool = await codeModeCapnwebEval.wrap(tools)
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const addResult = await api.tool_0({ a: 5, b: 3 })
        const greetResult = await api.tool_1({ name: 'World' })
        return { sum: addResult.result, greeting: greetResult.message }
      }`,
    })

    expect(result).toEqual({ sum: 8, greeting: 'Hello, World!' })
  }, 10000)

  it('supports async/await (sequential awaits)', async () => {
    const tools: Tool[] = [{
      description: 'Returns after delay',
      inputSchema: jsonSchema({ type: 'object', properties: { n: { type: 'number' } }, required: ['n'] }),
      execute: async ({ n }: { n: number }) => ({ n }),
    }]

    const wrappedTool = await codeModeCapnwebEval.wrap(tools)
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const a = await api.tool_0({ n: 1 })
        const b = await api.tool_0({ n: 2 })
        const c = await api.tool_0({ n: 3 })
        return { first: a.n, second: b.n, third: c.n }
      }`,
    })

    expect(result).toEqual({ first: 1, second: 2, third: 3 })
  }, 10000)

  it('executes user code that calls RpcToolset tools', async () => {
    const dtsContent = await readFile('dist/rpc-toolset-test-helpers.d.mts', 'utf-8')

    const wrappedTool = await codeModeCapnwebEval.wrap({ testToolset: () => new TestToolset() }, dtsContent)
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const toolset = await api.testToolset()
        const addResult = await toolset.add({ a: 10, b: 5 })
        return { result: addResult }
      }`,
    })

    expect(result).toEqual({ result: 15 })
  }, 10000)

  it('executes user code that chains RpcToolset tools', async () => {
    const dtsContent = await readFile('dist/rpc-toolset-test-helpers.d.mts', 'utf-8')

    const wrappedTool = await codeModeCapnwebEval.wrap({ testToolset: () => new TestToolset() }, dtsContent)
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const toolset1 = api.testToolset()
        const toolset2 = toolset1.toolset2()
        return toolset2.subtract({ a: 20, b: 8 })
      }`,
    })

    expect(result).toEqual(12)
  }, 10000)
})
