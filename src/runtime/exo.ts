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
 * Only the destructured caps are available. exoeval enforces this at the
 * interpreter level.
 */

import type { Provider } from './provider'

/**
 * An exo module's default export signature.
 * Caps are received as a single object, destructured by the exo.
 */
export type ExoFn = (caps: Record<string, object>) => Promise<void>

/**
 * Metadata for an exo — loaded from its module.
 */
export interface ExoDef {
  readonly name: string
  readonly path: string
  readonly run: ExoFn
}

/**
 * Loads an exo from a module. The module must `export default` an async
 * function that takes a caps object.
 *
 * For now (pre-exoeval), we just dynamically import the module.
 * Task 3 will wire this through exoeval + esbuild.
 */
export async function loadExo(name: string, path: string): Promise<ExoDef> {
  const mod = await import(path)
  const run = mod.default

  if (typeof run !== 'function') {
    throw new TypeError(`Exo "${name}" must export default an async function, got ${typeof run}`)
  }

  return { name, path, run }
}

/**
 * Runs an exo with scoped caps from an environment.
 *
 * The runner:
 * 1. Resolves which caps the exo needs (for now: passes all caps)
 * 2. Builds a scoped cap object
 * 3. Executes the exo
 *
 * When exoeval is wired in (Task 3), the scoping will be enforced by
 * the interpreter — only destructured caps are accessible.
 */
export class ExoRunner {
  private providers: Map<string, Provider> = new Map()

  /** Register a provider by name. */
  use(name: string, provider: Provider): this {
    this.providers.set(name, provider)
    return this
  }

  /** Build the full caps object from all registered providers. */
  private buildCaps(): Record<string, object> {
    const caps: Record<string, object> = {}
    for (const [name, provider] of this.providers) {
      caps[name] = provider.capabilities()
    }
    return caps
  }

  /** Run an exo with the full caps. exoeval will scope via destructuring. */
  async run(exo: ExoDef): Promise<void> {
    const caps = this.buildCaps()
    await exo.run(caps)
  }

  /** Shut down all providers. */
  async close(): Promise<void> {
    const providers = [...this.providers.values()].reverse()
    for (const provider of providers) {
      if (provider.close) {
        await provider.close()
      }
    }
  }
}
