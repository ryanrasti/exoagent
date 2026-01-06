import type { Tool, ToolExecutionOptions } from 'ai'
import { asSchema } from 'ai'
import camelCase from 'camelcase'
import { RpcTarget } from 'capnweb'
import { validate } from 'json-schema'
import { compile as compileJsonSchemaToTs } from 'json-schema-to-typescript'
import invariant from 'tiny-invariant'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { RpcToolset } from './rpc-toolset'

export type WrappableTools = { [key: string]: Tool | (() => RpcToolset) } | Tool[]

const extractTypeBody = (interfaceCode: string): string => {
  const match = interfaceCode.match(/interface \w+ \{([\s\S]*)\}/)
  if (!match) {
    return 'object'
  }

  let body = match[1]!.trim()

  // Remove index signature like [k: string]: unknown
  body = body.replace(/\[k: string\]: unknown\s*/g, '')
  body = body.replace(/\[key: string\]: any\s*/g, '')

  // Clean up extra newlines and format with commas
  const lines = body
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('['))

  if (lines.length === 0) {
    return 'object'
  }

  // Join with commas and proper spacing
  const formatted = lines.join('; ').replace(/;+/g, ';')
  return `{ ${formatted} }`
}

const getJsonSchema = (schema: unknown): Parameters<typeof compileJsonSchemaToTs>[0] => {
  // Check if it's a zod schema (has _def property or is a zod object)
  if (
    schema != null
    && typeof schema === 'object'
    && ('_def' in schema
      || ('parse' in schema && 'safeParse' in schema && 'shape' in schema))
  ) {
    try {
      return zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0]) as Parameters<
        typeof compileJsonSchemaToTs
      >[0]
    }
    catch {
      // If zod conversion fails, fall back to treating as JSON schema
      return schema as Parameters<typeof compileJsonSchemaToTs>[0]
    }
  }
  return schema as Parameters<typeof compileJsonSchemaToTs>[0]
}

export async function* generateToolTypes(
  tools: WrappableTools,
  name: string,
): AsyncGenerator<string, void, unknown> {
  yield `class ${name} {`

  const toolEntries = Array.isArray(tools)
    ? tools.map(
        (tool, index) =>
          [
            tool.title ?? `tool_${index}`,
            tool,
          ] as [string, Tool],
      )
    : Object.entries(tools)

  for (const [toolName, tool] of toolEntries) {
    if (typeof tool === 'function') {
      const toolset = tool()
      yield `// \`RpcToolset\`: ${toolName} (see .d.ts below for methods)`
      yield `  ${toolName}: () => RpcPromise<${toolset.constructor.name}>`
      continue
    }
    const inputSchema = getJsonSchema(tool.inputSchema)
    const outputSchema = tool.outputSchema
      ? getJsonSchema(tool.outputSchema)
      : null

    const inputJsonType = await compileJsonSchemaToTs(
      inputSchema,
      `${camelCase(toolName, { pascalCase: true })}Input`,
      {
        format: false,
        bannerComment: ' ',
      },
    )

    const outputJsonType = outputSchema
      ? await compileJsonSchemaToTs(
          outputSchema,
          `${camelCase(toolName, { pascalCase: true })}Output`,
          {
            format: false,
            bannerComment: ' ',
          },
        )
      : null

    const inputTypeBody = extractTypeBody(inputJsonType)
    const outputTypeBody = outputJsonType
      ? extractTypeBody(outputJsonType)
      : 'object'

    const description = tool.description?.trim() ?? ''
    const toolDoc = description
      ? `\n  /**\n   * ${description}\n   */`
      : ''

    yield `${toolDoc}\n  ${toolName}: (input: ${inputTypeBody}) => RpcPromise<${outputTypeBody}>;`
  }

  yield `}\n\nexport default ${name};`
}

export const generateToolApi = (tools: WrappableTools, opts: ToolExecutionOptions) => {
  class ToolApi extends RpcTarget {
    __return_value__: unknown = null
    __raw_code__: string

    constructor(code: string) {
      super()
      this.__raw_code__ = code
    }

    async __code__(): Promise<string> {
      return this.__raw_code__
    }

    __return__(result: unknown) {
      this.__return_value__ = result
    }
  }

  const toolEntries = Array.isArray(tools)
    ? tools.map(
        (tool, index) =>
          [
            tool.title ?? `tool_${index}`,
            tool,
          ] as [string, Tool],
      )
    : Object.entries(tools)
  for (const [toolName, tool] of toolEntries) {
    // We modify the prototype because Cap'n Web will only call methods on the
    // prototype, not the instance.
    (ToolApi.prototype as any)[toolName] = async function (this: ToolApi, ...args: any) {
      if (typeof tool === 'function') {
        // If it's a toolset, then it's a zero-arg function:
        const toolset = tool()
        invariant(toolset instanceof RpcToolset, 'Tool must return an instance of RpcToolset')
        return toolset
      }

      if (args.length !== 1) {
        throw new Error(`Tool ${toolName} only accepts exactly one argument, but ${args.length} were provided`)
      }
      // Get JSON schema for validation
      const schema = asSchema(tool.inputSchema)
      const jsonSchema = await schema.jsonSchema

      // Validate arguments
      const validation = validate(args[0], jsonSchema)
      if (!validation.valid) {
        throw new Error(`Invalid arguments for tool ${toolName}: ${validation.errors.map(e => e.message || e.property).join(', ')}`)
      }
      if (!tool.execute) {
        throw new Error(`Tool ${toolName} does not have an execute function`)
      }
      return tool.execute(args[0], opts)
    }
  }

  return ToolApi
}

export type ToolApi = InstanceType<ReturnType<typeof generateToolApi>>
