import type { ToolExecutionOptions } from 'ai'
import type { Policy } from './policy'
import { z } from 'zod'
import { normalizeTaint, safeEval, Value } from './eval'

export type CodeModeOptions<Sinks extends readonly string[]> = {
  api: object
  policy: Policy<string[], [...Sinks]>
  dts?: string
  /** The sink to check at the output boundary (required) */
  outputSink: Sinks[number]
  /** Maximum cost (tool calls) per turn. Defaults to 10. */
  maxCost?: number
}

export function codeMode<Sinks extends readonly string[]>(opts: CodeModeOptions<Sinks>) {
  const { api, policy, dts = '', outputSink, maxCost = 10 } = opts

  return {
    description: `Execute code using the following API. You MUST call this tool to run any code - never output code directly in your response.

        \`\`\`typescript
        type Primitive = string | number | boolean | null | undefined | bigint | Date | Uint8Array | Error;
        type Returnable = Primitive | { [key: string]: Returnable } | Returnable[];
        \`\`\`

        ${dts ? `// .d.ts for the \`RpcToolset\`s:\n${dts}` : ''}

        Provide a valid **javascript** (NOT TypeScript) function taking a single argument of type \`Tools\` and returning
        a value of type \`Promise<Returnable>\ | Returnable\`.

        Important: the JavaScript interpreter is limited to the following expression/statement types:
        - Literals: booleans, strings, numbers, null, undefined, bigint
        - Member access: \`foo.bar\`
        - Function invocation: \`bar(baz)\`
        - Variable assignment: \`const a = ...\`
        - Functions (\`=>\` functions only): \`(a, b, c) => ...\`
        - Block statements \`{ a; b; c; }\`
        - Await expression: \`await ...\`
        - Arrow functions: \`(a, b, c) => ...\`
        - Async functions: \`async (a, b, c) => ...\`
        ANY OTHER FEATURES WILL RESULT IN AN ERROR (e.g., \`if/else\`, \`for/while\`, \`try/catch\`, \`switch/case\`, etc.).

        Also, no globals are available or prototype methods on standard objects (e.g., Array.prototype.map). You
        only have access to the \`api\` object and its methods (recursively).

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
    execute: async ({ code }: { code: string }, _opts: ToolExecutionOptions): Promise<unknown> => {
      // Create a fresh TurnPolicy for each execution (fresh cost counter)
      const turn = policy.turn(maxCost)
      const checkPolicy = turn.createUnwrapChecker([normalizeTaint(outputSink)])

      try {
        const result = await safeEval(`(${code})(api)`, Value.of({ api }), turn.doStubCall.bind(turn))
        return result.unwrap(checkPolicy)
      }
      catch (err) {
        console.warn('[codeMode] Execution error:', err)
        throw err
      }
    },
  }
}
