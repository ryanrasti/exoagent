import type { Tool } from 'ai'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { codemode } from './code-mode.js'
import { TestToolset } from './rpc-toolset-test-helpers'

describe('codeMode', () => {
  it('executes user code that calls tools', async () => {
    const tools: Tool[] = [
      {
        description: 'Adds two numbers',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }: { a: number, b: number }) => ({ result: a + b }),
      },
      {
        description: 'Greets a person',
        inputSchema: z.object({ name: z.string() }),
        execute: async ({ name }: { name: string }) => ({ message: `Hello, ${name}!` }),
      },
    ]

    const wrappedTool = await codemode(tools)
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const addResult = await api.tool_0({ a: 5, b: 3 })
        const greetResult = await api.tool_1({ name: 'World' })
        return { sum: addResult.result, greeting: greetResult.message }
      }`,
    })

    expect(result).toEqual({ sum: 8, greeting: 'Hello, World!' })
  }, 10000)

  it('validates tool arguments and rejects invalid input', async () => {
    const tools: Tool[] = [
      {
        description: 'Adds two numbers',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }: { a: number, b: number }) => ({ result: a + b }),
      },
    ]

    const wrappedTool = await codemode(tools)
    const result = (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        await api.tool_0({ a: 'not a number', b: 3 })
        return { success: false, error: 'Should have failed validation' }
      }`,
    })

    await expect(result).rejects.toThrow(/Invalid value/)
  }, 10000)

  it('executes user code that calls RpcToolset tools', async () => {
    // Assume npm run build:test-deps has been run
    const dtsContent = await readFile('dist/rpc-toolset-test-helpers.d.ts', 'utf-8')

    const wrappedTool = await codemode({ testToolset: new TestToolset() }, dtsContent)
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const toolset = api.testToolset
        const addResult = await toolset.add({ a: 10, b: 5 })
        return { result: addResult }
      }`,
    })

    expect(result).toEqual({ result: 15 })
  }, 10000)

  it('executes user code that chains RpcToolset tools', async () => {
    // Assume npm run build:test-deps has been run
    const dtsContent = await readFile('dist/rpc-toolset-test-helpers.d.ts', 'utf-8')

    const wrappedTool = await codemode({ testToolset: new TestToolset() }, dtsContent)
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const toolset1 = api.testToolset
        const toolset2 = await toolset1.toolset2()
        return { result: await toolset2.subtract({ a: 20, b: 8 }) }
      }`,
    })

    expect(result).toEqual({ result: 12 })
  }, 10000)

  it('validates RpcToolset tool arguments and rejects invalid input', async () => {
    // Assume npm run build:test-deps has been run
    const dtsContent = await readFile('dist/rpc-toolset-test-helpers.d.ts', 'utf-8')

    const wrappedTool = await codemode({ testToolset: new TestToolset() }, dtsContent)
    const result = (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
          const toolset = api.testToolset
          // Passing string for number field 'a'
          await toolset.add({ a: 'not a number', b: 3 })
          return { success: false, error: 'Should have failed validation' }
      }`,
    })

    await expect(result).rejects.toThrow(/Invalid value: Invalid input: expected number, received string for argument 0/)
  }, 10000)
})
