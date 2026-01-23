import type { Tool, ToolExecutionOptions } from 'ai'
import type { RpcToolset } from './rpc-toolset'
import type { WrappableTools } from './tool-wrapper'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RpcSession } from 'capnweb'
import { z } from 'zod'
import { StreamTransport } from './stream-transport'
import { generateToolApi, generateToolTypes } from './tool-wrapper'

// Lazy-load the bundled runtime code to avoid filesystem access at import time
// This is important for environments like Cloudflare Workers that don't have fs access
let _BUNDLED_RUNTIME_CODE: string | undefined
function getBundledRuntimeCode(): string {
  if (_BUNDLED_RUNTIME_CODE === undefined) {
    _BUNDLED_RUNTIME_CODE = readFileSync(
      fileURLToPath(new URL('../dist/code-mode-runtime.mjs', import.meta.url) as URL),
      'utf-8',
    )
  }
  return _BUNDLED_RUNTIME_CODE
}

export type SafeEvalResult = {
  wait: () => Promise<void>
  input: ReadableStream<Uint8Array>
  output: WritableStream<Uint8Array>
}

export type SafeEvalContext = {
  safeEval: (code: string) => Promise<SafeEvalResult>
  // See code-mode-runtime.ts for the expected format of the sandbox context
  sandboxContext: string
}

type FlatTools = { [key: string]: Tool } | Tool[]
type RpcTools = { [key: string]: () => RpcToolset }

export class CodeMode {
  constructor(private context: SafeEvalContext) {}

  wrap(tools: FlatTools): Promise<Tool>
  wrap(tools: RpcTools | FlatTools, dts: string): Promise<Tool>
  async wrap(tools: WrappableTools, dts?: string): Promise<Tool> {
    // 1. Consume raw tools

    const typeDefinitions: string[] = []
    for await (const chunk of generateToolTypes(tools, 'Tools')) {
      typeDefinitions.push(chunk)
    }
    const definitions = typeDefinitions.join('')

    // 2. Generate new tool that uses the tools (as classes)
    return {
      description: `Write code to use the following tools:.
        
        \`\`\`typescript
        ${definitions}

        type Primitive = string | number | boolean | null | undefined | bigint | Date | Uint8Array | Error;
        type Returnable = Primitive | { [key: string]: Returnable } | Returnable[];
        \`\`\`

        ${dts ? `// .d.ts for the \`RpcToolset\`s:\n${dts}` : ''}

        You must write the code in the following format:
        \`\`\`typescript
            
        
            (api: Tools) => Promise<Returnable> {
                // Call the tools here
                // The returned result will be passed back into context
            }
        \`\`\`
        `,
      inputSchema: z.object({
        code: z.string(),
      }),
      execute: async ({ code }: { code: string }, opts: ToolExecutionOptions) => {
        // 1. Inject sandbox context into bundled runtime
        const injectedCode = `globalThis.__SANDBOX_CONTEXT_PROMISE__ = ${this.context.sandboxContext};\n${getBundledRuntimeCode()}`
        const { input, output, wait } = await this.context.safeEval(injectedCode)

        // 2. Hook up the input and output streams:
        const ToolApi = generateToolApi(tools, opts)
        const api = new ToolApi(code)
        const transport = new StreamTransport(input, output)
        const _session = new RpcSession(transport, api)
        // Remote side should have access to api via RPC and execute the code
        await wait()
        return api.__return_value__
      },
    }
  }
}
