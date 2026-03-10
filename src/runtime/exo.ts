/**
 * An Exo is a sandboxed program. It declares its caps by destructuring
 * the first argument of its default export.
 *
 * ```javascript
 * export default async ({ sandbox, review, storage }) => {
 *   await sandbox.exec({ command: 'echo hello' })
 * }
 * ```
 *
 * Only the destructured caps are available — exoeval enforces this at
 * the interpreter level. Every exo gets the full cap set; the destructure
 * is the audit trail for what it actually uses.
 */

import { exoImport } from '../exoeval'

/**
 * An exo module's default export signature.
 * Caps are received as a single object, destructured by the exo.
 */
export type ExoFn = (caps: Record<string, object>) => void | Promise<void>

/**
 * Metadata for an exo — loaded from its module.
 */
export interface ExoDef {
  readonly name: string
  readonly run: ExoFn
}

/**
 * Loads an exo from source code via exoImport (the sandboxed interpreter).
 * The source must `export default` a function that takes a caps object.
 *
 * Source should already be plain JS (run through esbuild if TypeScript).
 */
export async function loadExo(name: string, code: string): Promise<ExoDef> {
  const mod = await exoImport(code)
  const run = mod.default

  if (typeof run !== 'function') {
    throw new TypeError(`Exo "${name}" must export default a function, got ${typeof run}`)
  }

  return { name, run: run as ExoFn }
}

