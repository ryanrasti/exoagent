import type { ToolExecutionOptions } from 'ai'
import { safeEval, Value } from './eval'
import { z } from 'zod'


export const codeMode = (api: object, policy: Policy<string[], string[]>, dts: string) => {
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
        ANY OTHER FEATURES WILL RESULT IN AN ERROR.
        
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
          return await safeEval(code, Value.of(api), policy)
      },
    }
  }

