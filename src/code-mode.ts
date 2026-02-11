import type { ToolExecutionOptions } from 'ai'
import type { Taint } from './eval/utils'
import type { Policy } from './policy'
import { z } from 'zod'
import { normalizeTaint, safeEval, Value } from './eval'

export type CodeModeOptions<Sinks extends readonly string[]> = {
  api: object
  policy: Policy<string[], [...Sinks]>
  dts?: string
  /** The sink to check at the output boundary (required) */
  outputSink: Sinks[number]
  inputTaints: Taint[]
  /** Maximum cost (tool calls) per turn. Defaults to 10. */
  maxCost?: number
}

/** Result from a codeMode execution */
export type CodeModeResult = {
  response: string
  data: unknown
  taints: Taint[]
}

/** Validate that a value is a valid turn result */
function validateTurnResult(value: unknown): { response: string, data: unknown } {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Code must return an object with { response: string, data: unknown }')
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.response !== 'string') {
    throw new Error('Code must return an object with "response" as a string')
  }
  if (!('data' in obj)) {
    throw new Error('Code must return an object with a "data" field')
  }
  return { response: obj.response, data: obj.data }
}

export function codeMode<Sinks extends readonly string[]>(opts: CodeModeOptions<Sinks>) {
  const { api, policy, dts = '', outputSink, maxCost = 10 } = opts

  return {
    description: `Execute code to interact with the API. Your code MUST return an object with this shape:

        { response: string, data: unknown }

        - "response": The message to show the user. This is what they will see.
        - "data": Any data you want to preserve in context for future turns. This is NOT shown to the user but will be available to you in subsequent turns.

        Available API:
        \`\`\`typescript
        ${dts || '// No API types provided'}
        \`\`\`

        Your code must be a valid **JavaScript** (NOT TypeScript) arrow function taking \`api\` as its argument.

        IMPORTANT - The interpreter is LIMITED to:
        - Literals: strings, numbers, booleans, null, undefined, bigint
        - Object/array literals: { key: "value" }, [1, 2, 3]
        - Member access: api.gmail.get
        - Function calls: api.gmail.get({ id: "123" })
        - Variable declarations: const x = ...
        - Arrow functions: (x) => x + 1
        - Async/await: async (api) => { const x = await api.foo(); return x; }
        - Block statements: { const a = 1; const b = 2; return { response: "", data: null }; }

        NOT SUPPORTED (will error):
        - if/else, for, while, switch, try/catch
        - Prototype methods (no .map, .filter, .forEach, etc.)
        - Globals (no console, Math, JSON, etc.)
        - Template literals
        - Destructuring in parameters

        Example:
        \`\`\`javascript
        async (api) => {
          const emails = await api.gmail.list({ maxResults: 5, query: "is:unread" })
          return {
            response: "You have " + emails.length + " unread emails",
            data: { emailIds: emails }
          }
        }
        \`\`\`
        `,
    inputSchema: z.object({
      code: z.string(),
    }),
    execute: async ({ code }: { code: string }, _opts: ToolExecutionOptions): Promise<CodeModeResult> => {
      // Create a fresh TurnPolicy for each execution (fresh cost counter)
      const turn = policy.turn(maxCost)
      const checkPolicy = turn.createUnwrapChecker([normalizeTaint(outputSink)])

      try {
        const result = await safeEval(`(${code})(api)`, Value.of({ api }), turn.doStubCall.bind(turn))

        // Capture taints before unwrapping
        const taints = result.getTaints()

        // Unwrap and validate
        const unwrapped = result.unwrap(checkPolicy)
        const validated = validateTurnResult(unwrapped)

        return {
          response: validated.response,
          data: validated.data,
          taints,
        }
      }
      catch (err) {
        console.warn('[codeMode] Execution error:', err)
        throw err
      }
    },
  }
}
