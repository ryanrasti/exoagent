import type { ToolExecutionOptions } from 'ai'
import type { Taint } from './eval/utils'
import type { Policy } from './policy'
import { z } from 'zod'
import { GlobalScope, normalizeTaint, safeEval, Value } from './eval'

export type CodeModeOptions<Sinks extends readonly string[]> = {
  /** Global scope object - all properties become globals in the REPL */
  globals: {
    /** API object (methods require @tool annotations) */
    api: object
    /** Builtin functions (methods require @tool annotations) */
    builtin: object
  }
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
  taints: Taint[]
  error?: {
    message: string
    stack?: string
    code?: string
  }
}

export function codeMode<Sinks extends readonly string[]>(opts: CodeModeOptions<Sinks>) {
  const { globals, policy, dts = '', outputSink, inputTaints, maxCost = 10 } = opts

  return {
    description: `Execute JavaScript code. All capabilities are available as globals.

Available globals:
\`\`\`typescript
${dts || '// No type definitions provided'}
\`\`\`

IMPORTANT - The interpreter is LIMITED to:
- Literals: strings, numbers, booleans, null, undefined, bigint
- Object/array literals: { key: "value" }, [1, 2, 3]
- Member access: obj.prop
- Function calls: gmail.list({ query: "is:unread" })
- Variable declarations: const x = ...
- Arrow functions: (x) => x + 1
- Async/await: const result = await gmail.list(...)
- Block statements with return
- If/else statements
- Ternary expressions: condition ? a : b
- Comparison operators: ===, !==, >, <, >=, <=
- Arithmetic operators: +, -, *, /, %
- Logical operators: &&, ||
- String concatenation and template literals

NOT SUPPORTED (will error):
- for, while, switch, try/catch
- Prototype methods (no .map, .filter, .forEach, etc.)
- Built-in globals (no console, Math, JSON, etc.)

IMPORTANT:
- builtin.respond(message) is the ONLY output shown to the user
- builtin.setToolCallResult(data) stores data for future turns (NOT shown to user)
- Write code on multiple lines for readability

Example:
\`\`\`javascript
const emails = await api.gmail.list({ maxResults: 5, query: "is:unread" })

builtin.respond(\`You have \${emails.length} unread emails\`)
builtin.setToolCallResult({ emailCount: emails.length })
\`\`\`
`,
    inputSchema: z.object({
      code: z.string(),
    }),
    execute: async ({ code }: { code: string }, _opts: ToolExecutionOptions): Promise<CodeModeResult> => {
      // Create a fresh TurnPolicy for each execution (fresh cost counter)
      // Pass inputTaints as ambient taints - they apply to all egress points
      const turn = policy.turn(maxCost, inputTaints)
      const checkPolicy = turn.createUnwrapChecker([normalizeTaint(outputSink)])

      try {
        // Wrap globals as Values and create a GlobalScope
        // Both api and builtin methods go through policy (require @tool annotations)
        const wrappedGlobals: { [key: string]: Value } = {
          api: Value.of(globals.api, [], { shallow: true }),
          builtin: Value.of(globals.builtin, [], { shallow: true }),
        }
        const scope = new GlobalScope(Value.of(wrappedGlobals, [], { shallow: true }), false)

        const result = await safeEval(code, scope, turn.doStubCall.bind(turn))

        // Capture taints before unwrapping
        const taints = result.getTaints()

        // Unwrap to run policy checks on any returned value
        result.unwrap(checkPolicy)

        return { taints }
      }
      catch (err) {
        console.warn('[codeMode] Execution error:', err)
        return {
          taints: [],
          error: {
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            code,
          },
        }
      }
    },
  }
}
