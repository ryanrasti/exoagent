import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Tool, ToolExecutionOptions } from 'ai'
import type { ToolFunction } from './exoeval'
import { asSchema } from '@ai-sdk/provider-utils'
import camelCase from 'camelcase'
import { compile as compileJsonSchemaToTs } from 'json-schema-to-typescript'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { asToolFn } from './exoeval'
import { isToolableFunction } from './exoeval/tool'

export type WrappableTools = { [key: string]: Tool } | Tool[] | { [k in string]: ToolFunction }

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

const toStandardSchema = (schema: Tool['inputSchema']): StandardSchemaV1 => {
  if (schema && typeof schema === 'object' && '~standard' in schema) {
    return schema
  }

  const base = asSchema(schema as any)
  const vendor = '@ai-sdk/provider-utils'

  const validateFn = base.validate
  if (!validateFn) {
    throw new TypeError('Schema has no validate method; use a schema with validation (e.g. Zod) or add JSON Schema validation support')
  }
  return {
    '~standard': {
      version: 1,
      vendor,
      validate: (value: unknown) => {
        const result = validateFn(value)
        if (!('success' in result)) {
          throw new Error('Validation must be synchronous')
        }
        return result.success
          ? { value: result.value }
          : { issues: [{ message: result.error.message }] }
      },
    },
  }
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
    const inputSchema = getJsonSchema(tool.inputSchema)
    const outputSchema = tool.outputSchema
      ? getJsonSchema(tool.outputSchema)
      : null

    const compileOpts = {
      format: false,
      bannerComment: ' ',
      cwd: '/',
    }

    const inputJsonType = await compileJsonSchemaToTs(
      inputSchema,
      `${camelCase(toolName, { pascalCase: true })}Input`,
      compileOpts,
    )

    const outputJsonType = outputSchema
      ? await compileJsonSchemaToTs(
          outputSchema,
          `${camelCase(toolName, { pascalCase: true })}Output`,
          compileOpts,
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

const wrapTool = (tool: Tool, opts: ToolExecutionOptions): ((...args: unknown[]) => unknown) => {
  if (!tool.execute) {
    throw new Error(`Tool ${tool.title} does not have an execute function`)
  }
  const schema = toStandardSchema(tool.inputSchema)
  return asToolFn((input: unknown) => tool.execute!(input, opts), [schema])
}

export const wrapTools = (tools: WrappableTools, opts: ToolExecutionOptions): { [k in string]: ToolFunction } => {
  const toolEntries = Array.isArray(tools)
    ? tools.map(
        (tool, index) =>
          [
            tool.title ?? `tool_${index}`,
            wrapTool(tool, opts),
          ] as const,
      )
    : Object.entries(tools).map(([toolName, tool]) => [toolName, isToolableFunction(tool) ? tool : wrapTool(tool, opts)])
  return Object.fromEntries(toolEntries)
}
