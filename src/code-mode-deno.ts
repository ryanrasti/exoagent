// Deno-specific sandbox implementation for CodeMode
// This provides a SafeEvalContext that uses Deno instead of Node.js

import type { SafeEvalContext, SafeEvalResult } from './code-mode.js'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

/**
 * Creates a SafeEvalContext that uses Deno as the sandbox runtime.
 *
 * @param options - Configuration options for Deno sandbox
 * @param options.args - Deno custom arguments (default: [])
 * @param options.denoPath - Path to deno executable (default: 'deno')
 * @returns A SafeEvalContext configured for Deno
 */
export function createDenoSandbox(options: {
  args?: string[]
  denoPath?: string
} = {}): SafeEvalContext {
  const { args = [], denoPath = 'deno' } = options

  return {
    safeEval: async (code: string): Promise<SafeEvalResult> => {
      const tempDir = await mkdtemp(join(tmpdir(), 'exoagent-deno-'))
      const tempFile = join(tempDir, 'code.ts') // Deno can run TypeScript directly

      await writeFile(tempFile, code, 'utf-8')

      // Deno command: deno run < ... args > code.ts
      // Note: Deno's stdin/stdout are already Web Streams, but we need to convert
      // from Node.js child_process streams to Web Streams for the parent process
      const child = spawn(denoPath, ['run', ...args, tempFile], {
        stdio: ['pipe', 'pipe', 'inherit'],
      })

      return {
        input: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        output: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        wait: () => new Promise<void>((resolve, reject) => {
          child.on('exit', async (code) => {
            await rm(tempDir, { recursive: true, force: true }).catch(() => {})
            code === 0 ? resolve() : reject(new Error(`Deno process exited with code ${code}`))
          })
          child.on('error', async (err) => {
            await rm(tempDir, { recursive: true, force: true }).catch(() => {})
            reject(err)
          })
        }),
      }
    },
    sandboxContext: `Promise.resolve({
      input: Deno.stdin.readable,
      output: Deno.stdout.writable,
      onSuccess: () => Deno.exit(0),
      onFailure: () => Deno.exit(1)
    })`,
  }
}
