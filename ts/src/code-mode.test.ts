import type { Tool } from 'ai'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { jsonSchema } from 'ai'
import { describe, expect, it } from 'vitest'
import { CodeMode } from './code-mode.js'

const codeMode = new CodeMode({
  safeEval: async (code: string) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'exoagent-test-'))
    const tempFile = join(tempDir, 'code.mjs')
    await writeFile(tempFile, code, 'utf-8')
    const child = spawn('node', [tempFile], { stdio: ['pipe', 'pipe', 'inherit'] })
    return {
      input: Readable.toWeb(child.stdout),
      output: Writable.toWeb(child.stdin),
      wait: () => new Promise<void>((resolve, reject) => {
        child.on('exit', async (code) => {
          await rm(tempDir, { recursive: true, force: true }).catch(() => {})
          code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`))
        })
        child.on('error', async (err) => {
          await rm(tempDir, { recursive: true, force: true }).catch(() => {})
          reject(err)
        })
      }),
    }
  },
  sandboxContext: `(async () => {
    const { Readable, Writable } = await import('node:stream')
    return {
      input: Readable.toWeb(process.stdin),
      output: Writable.toWeb(process.stdout),
      onSuccess: () => process.exit(0),
      onFailure: () => process.exit(1)
    }
  })()`,
})

describe('codeMode', () => {
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

    const wrappedTool = await codeMode.wrap(tools)
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const addResult = await api.tool_0({ a: 5, b: 3 })
        const greetResult = await api.tool_1({ name: 'World' })
        return { sum: addResult.result, greeting: greetResult.message }
      }`,
    })

    expect(result).toEqual({ sum: 8, greeting: 'Hello, World!' })
  }, 10000)

  it('handles tool errors', async () => {
    const tools: Tool[] = [{
      description: 'Throws an error',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => { throw new Error('Test error') },
    }]

    const wrappedTool = await codeMode.wrap(tools)
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        try {
          await api.tool_0({})
          return { success: false }
        } catch (error) {
          return { success: true, error: error.message }
        }
      }`,
    })

    expect(result).toEqual({ success: true, error: 'Test error' })
  }, 10000)

  it('validates tool arguments and rejects invalid input', async () => {
    const tools: Tool[] = [
      {
        description: 'Adds two numbers',
        inputSchema: jsonSchema({ type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] }),
        execute: async ({ a, b }: { a: number, b: number }) => ({ result: a + b }),
      },
    ]

    const wrappedTool = await codeMode.wrap(tools)
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        try {
          // Passing string for number field 'a'
          await api.tool_0({ a: 'not a number', b: 3 })
          return { success: false, error: 'Should have failed validation' }
        } catch (error) {
          const errorMsg = error?.message || String(error)
          return { success: true, error: errorMsg }
        }
      }`,
    })

    expect(result).toMatchObject({ success: true })
    expect((result as { error: string }).error).toBe('Invalid arguments for tool tool_0: not a number - string value found, but a number is required')
  }, 10000)
})
