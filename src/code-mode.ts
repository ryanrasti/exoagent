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
  const apiFields: string[] = []

  for (const [name, cap] of Object.entries(caps)) {
    if (cap && typeof cap === 'object' && 'dts' in cap && typeof (cap as DtsCapability).dts === 'function') {
      const capDts = await (cap as DtsCapability).dts()
      parts.push(`// <${name}>\n${capDts}`)
      // Use the class name from the capability for proper instance typing
      const className = cap.constructor.name
      apiFields.push(`${name}: ${className}`)
    }
  }

  // Add the Api type - each field is an INSTANCE of the capability class
  parts.push(`\n// <api>\n// IMPORTANT: These are pre-instantiated objects. Use them directly (e.g., api.browser.navigate(...))`)
  parts.push(`export interface Api { ${apiFields.join('; ')} }`)
  parts.push(`export default async function(api: Api): Promise<unknown>`)

  return parts.join('\n\n')
}

/**
 * Build the API interface declaration from tool names and their class types
 */
function buildApiInterface(tools: Record<string, object>): string {
  const apiFields = Object.entries(tools).map(([name, cap]) => {
    const className = cap.constructor.name
    return `${name}: ${className}`
  })
  return `
// <api>
// IMPORTANT: The 'api' parameter contains pre-instantiated objects. Use them directly:
//   - api.browser.navigate({ url: '...' })
//   - api.browser.snapshot()
// Do NOT try to instantiate classes with 'new'.
export interface Api { ${apiFields.join('; ')} }
export default async function(api: Api): Promise<unknown>`
}

export function codemode<R>(tools: FlatTools): Promise<ExecutableTool<R>>
export function codemode<R>(tools: object, dts: string): Promise<ExecutableTool<R>>
export async function codemode<R>(tools: object, dts?: string): Promise<ExecutableTool<R>> {
  const typeDefinitions: string[] = []
  const hasDts = Object.values(tools).some((tool) => typeof (tool as DtsCapability).dts === 'function')

  if (dts) {
    // When dts is provided directly, still need to add API interface wrapper
    typeDefinitions.push(dts)
    typeDefinitions.push(buildApiInterface(tools as Record<string, object>))
  }
  else if (hasDts) {
    typeDefinitions.push(await buildDts(tools))
  }
  else {
    for await (const chunk of generateToolTypes(tools as WrappableTools, 'Tools')) {
      typeDefinitions.push(chunk)
    }
  }

  const definitions = typeDefinitions.join('\n')

  return {
    description: `Execute code using the following API. You MUST call this tool to run any code - never output code directly in your response.

**CRITICAL SYNTAX RESTRICTIONS** - This runs in a restricted sandbox:
- ALLOWED: async/await, const, if/else, return, arrow functions, string methods (.includes, .substring, .split), array methods
- **FORBIDDEN - DO NOT USE**: try/catch, for, while, let, var, console.log, .then(), .catch(), .match(), new URLSearchParams, RegExp

If you use try/catch, loops, or .match(), your code WILL FAIL. Errors are reported automatically - do not handle them.

\`\`\`typescript
${definitions}
\`\`\`

Example:
\`\`\`javascript
async (api) => {
    await api.browser.navigate({ url: 'https://example.com' })
    const snapshot = await api.browser.snapshot()
    return { status: 'navigated', foundButton: snapshot.includes('Submit') }
}
\`\`\`
`,
    inputSchema: z.object({
      code: z.string(),
    }),
    execute: async ({ code }: { code: string }, opts: ToolExecutionOptions): Promise<R> => {
      console.log('[codemode] executing:\n' + code)
      try {
        const fn = exoEval(code)
        if (typeof fn !== 'function') {
          throw new TypeError('Code did not return a function')
        }
        const wrapped = dts || hasDts ? tools : wrapTools(tools as WrappableTools, opts)
        const result = await fn(wrapped)
        console.log('[codemode] result:', JSON.stringify(result))
        return result
      } catch (err) {
        console.log('[codemode] error:', err)
        throw err
      }
    },
  }
}
