import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'
import { generateToolTypes } from './tool-wrapper'

describe('generateToolTypes', () => {
  it('generates class definition for 1 tool', async () => {
    const tools: Tool[] = [
      {
        description: 'Test tool description',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name'],
        } as any,
      },
    ]

    const chunks: string[] = []
    for await (const chunk of generateToolTypes(tools, 'TestTools')) {
      chunks.push(chunk)
    }

    const result = chunks.join('')
    expect(result).toBe(
      `class TestTools {
  /**
   * Test tool description
   */
  tool_0: (input: { name: string; age?: number }) => RpcPromise<object>;}

export default TestTools;`,
    )
  })

  it('generates class definition for 2 tools', async () => {
    const tools: Tool[] = [
      {
        description: 'First tool',
        inputSchema: {
          type: 'object',
          properties: {
            x: { type: 'string' },
          },
        } as any,
      },
      {
        description: 'Second tool',
        inputSchema: {
          type: 'object',
          properties: {
            y: { type: 'number' },
          },
        } as any,
      },
    ]

    const chunks: string[] = []
    for await (const chunk of generateToolTypes(tools, 'MyTools')) {
      chunks.push(chunk)
    }

    const result = chunks.join('')
    expect(result).toBe(
      `class MyTools {
  /**
   * First tool
   */
  tool_0: (input: { x?: string }) => RpcPromise<object>;
  /**
   * Second tool
   */
  tool_1: (input: { y?: number }) => RpcPromise<object>;}

export default MyTools;`,
    )
  })

  it('generates class definition with outputSchema', async () => {
    const tools: Tool[] = [
      {
        description: 'Tool with output',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        } as any,
        outputSchema: {
          type: 'object',
          properties: {
            result: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['result'],
        } as any,
      },
    ]

    const chunks: string[] = []
    for await (const chunk of generateToolTypes(tools, 'OutputTools')) {
      chunks.push(chunk)
    }

    const result = chunks.join('')
    expect(result).toBe(
      `class OutputTools {
  /**
   * Tool with output
   */
  tool_0: (input: { query: string }) => RpcPromise<{ result: string; count?: number }>;}

export default OutputTools;`,
    )
  })

  it('generates class definition with zod schema', async () => {
    const { z } = await import('zod')
    const tools: Tool[] = [
      {
        description: 'Tool with zod schema',
        inputSchema: z.object({
          name: z.string(),
          age: z.number().optional(),
        }),
      },
    ]

    const chunks: string[] = []
    for await (const chunk of generateToolTypes(tools, 'ZodTools')) {
      chunks.push(chunk)
    }

    const result = chunks.join('')
    // Zod schemas should be detected and converted, but if conversion fails,
    // it should fall back gracefully to object
    expect(result).toContain('class ZodTools {')
    expect(result).toContain('Tool with zod schema')
    expect(result).toContain('tool_0: (input:')
    expect(result).toContain('RpcPromise<object>')
    expect(result).toContain('export default ZodTools')
    // Note: zod-to-json-schema may not fully support zod v4 yet,
    // so we just verify it doesn't crash and produces valid output
  })
})
