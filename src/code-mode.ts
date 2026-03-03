import type { Tool, ToolExecutionOptions } from 'ai'
import type { WrappableTools } from './tool-wrapper'
import { z } from 'zod'
import { exoEval } from './exoeval'
import { generateToolTypes, wrapTools } from './tool-wrapper'
import type { DtsCapability } from './capabilities'

type FlatTools = { [key: string]: Tool } | Tool[]

type ExecutableTool<R> = {
  description: string
  inputSchema: z.ZodSchema<{ code: string }>
  execute: (input: { code: string }, opts: ToolExecutionOptions) => Promise<R>
}

/**
 * Build the combined .d.ts from all caps that have dts() method
 */
async function buildDts(caps: Record<string, object>): Promise<string> {
  const parts: string[] = []

  for (const [name, cap] of Object.entries(caps)) {
    if (cap && typeof cap === 'object' && 'dts' in cap && typeof (cap as DtsCapability).dts === 'function') {
      const capDts = await (cap as DtsCapability).dts()
      parts.push(`// <${name}>\n${capDts}`)
    }
  }

  // Add the Api type
  const capNames = Object.keys(caps)
    .map((k) => `${k}: typeof import('./${k}')`)
    .join('; ')
  parts.push(`\n// <api>\nexport interface Api { ${capNames} }`)
  parts.push(`export default async function(api: Api): Promise<unknown>`)

  return parts.join('\n\n')
}

export function codemode<R>(tools: FlatTools): Promise<ExecutableTool<R>>
export function codemode<R>(tools: object, dts: string): Promise<ExecutableTool<R>>
export async function codemode<R>(tools: object, dts?: string): Promise<ExecutableTool<R>> {
  const typeDefinitions: string[] = []
  const hasDts = Object.values(tools).some((tool) => typeof (tool as DtsCapability).dts === 'function')

  if (dts) {
    typeDefinitions.push(dts)
  }
  else if (hasDts) {
    typeDefinitions.push(await buildDts(tools))
  }
  else {
    for await (const chunk of generateToolTypes(tools as WrappableTools, 'Tools')) {
      typeDefinitions.push(chunk)
    }
  }

  const definitions = typeDefinitions.join('')

  return {
    description: `Execute code using the following API. You MUST call this tool to run any code - never output code directly in your response.

        \`\`\`typescript
        ${definitions}

        Provide a valid **javascript** (NOT TypeScript) function taking a single argument of type \`Tools\` and returning
        a value of type \`Promise<Returnable>\`.

        Example:
        \`\`\`javascript
            (api) => {
                // Call the API here (only vanilla JS is allowed)
                // The returned result will be passed back into context
            }
        \`\`\`
        `,
    inputSchema: z.object({
      code: z.string(),
    }),
    execute: async ({ code }: { code: string }, opts: ToolExecutionOptions): Promise<R> => {
      const fn = exoEval(code)
      if (typeof fn !== 'function') {
        throw new TypeError('Code did not return a function')
      }
      const wrapped = dts || hasDts ? tools : wrapTools(tools as WrappableTools, opts)
      return await fn(wrapped)
    },
  }
}
