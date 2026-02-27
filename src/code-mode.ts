import type { Tool, ToolExecutionOptions } from 'ai'
import type { WrappableTools } from './tool-wrapper'
import { z } from 'zod'
import { exoEval } from './exoeval'
import { generateToolTypes, wrapTools } from './tool-wrapper'

type FlatTools = { [key: string]: Tool } | Tool[]

type ExecutableTool<R> = {
  description: string
  inputSchema: z.ZodSchema<{ code: string }>
  execute: (input: { code: string }, opts: ToolExecutionOptions) => Promise<R>
}

export function codemode<R>(tools: FlatTools): Promise<ExecutableTool<R>>
export function codemode<R>(tools: object, dts: string): Promise<ExecutableTool<R>>
export async function codemode<R>(tools: object, dts?: string): Promise<ExecutableTool<R>> {
  const typeDefinitions: string[] = []
  if (dts) {
    typeDefinitions.push(dts)
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
      const wrapped = dts ? tools : wrapTools(tools as WrappableTools, opts)
      return await fn(wrapped)
    },
  }
}
