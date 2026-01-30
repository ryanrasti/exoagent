import type { Tool, ToolExecutionOptions } from 'ai'
import type { RpcTarget } from 'capnweb'
import type { RpcToolset } from './rpc-toolset'
import type { WrappableTools } from './tool-wrapper'
import { RpcSession } from 'capnweb'
import { z } from 'zod'
// eslint-disable-next-line antfu/no-import-dist
import runtimeCode from '../dist/code-mode-runtime.mjs?raw'
import { StreamTransport } from './stream-transport'
import { generateToolApi, generateToolTypes } from './tool-wrapper'

export type SafeEvalResult = {
  wait: () => Promise<void>
  input: ReadableStream<Uint8Array>
  output: WritableStream<Uint8Array>
}

export type SafeEvalContext<R> = {
  kind: 'stream'
  safeEval: (code: string) => Promise<SafeEvalResult>
  // See code-mode-runtime.ts for the expected format of the sandbox context
  sandboxContext: string
} | {
  // We pass the code to the remote side to evaluate (over Cap'n Web),
  // along with the API object:
  kind: 'passthrough'
  safeEval: (code: string, api: RpcTarget) => Promise<R>
}

type FlatTools = { [key: string]: Tool } | Tool[]
type RpcTools = { [key: string]: () => RpcToolset }

type ExecutableTool<R> = {
  description: string
  inputSchema: z.ZodSchema<{ code: string }>
  execute: (input: { code: string }, opts: ToolExecutionOptions) => Promise<R>
}

export class CodeMode<R> {
  constructor(private context: SafeEvalContext<R>) {}

  wrap(tools: FlatTools): Promise<ExecutableTool<R>>
  wrap(tools: RpcTools | FlatTools, dts: string): Promise<ExecutableTool<R>>
  async wrap(tools: WrappableTools, dts?: string): Promise<ExecutableTool<R>> {
    // 1. Consume raw tools

    const typeDefinitions: string[] = []
    for await (const chunk of generateToolTypes(tools, 'Tools')) {
      typeDefinitions.push(chunk)
    }
    const definitions = typeDefinitions.join('')

    // 2. Generate new tool that uses the tools (as classes)
    return {
      description: `Execute code using the following API. You MUST call this tool to run any code - never output code directly in your response.

        \`\`\`typescript
        ${definitions}

        type Primitive = string | number | boolean | null | undefined | bigint | Date | Uint8Array | Error;
        type Returnable = Primitive | { [key: string]: Returnable } | Returnable[];
        \`\`\`

        ${dts ? `// .d.ts for the \`RpcToolset\`s:\n${dts}` : ''}

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
        const ToolApi = generateToolApi(tools, opts)
        const api = new ToolApi(code)

        if (this.context.kind === 'passthrough') {
          return await this.context.safeEval(code, api)
        }

        // 1. Inject sandbox context into bundled runtime
        const injectedCode = `globalThis.__SANDBOX_CONTEXT_PROMISE__ = ${this.context.sandboxContext};\n${runtimeCode}`
        const { input, output, wait } = await this.context.safeEval(injectedCode)

        // 2. Hook up the input and output streams:
        const transport = new StreamTransport(input, output)
        const _session = new RpcSession(transport, api)
        // Remote side should have access to api via RPC and execute the code
        await wait()
        return api.__return_value__ as unknown as R
      },
    }
  }
}
