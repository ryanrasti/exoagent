/**
 * Dev environment — wires provider classes to config/secrets and produces
 * an ExoRunner ready to execute exos.
 *
 * This is the composition root. It knows about concrete provider classes
 * and how to configure them. Exos and the daemon import this to get a
 * fully wired runner.
 *
 * Future: prod.ts, test.ts, etc. with different provider configs.
 */

import type { Provider } from './provider'
import { ExoRunner } from './exo'

// Placeholder providers for Task 1.
// Real providers (storage, sandbox, pi, review, secrets) replace these
// as they're built in Tasks 4-8.

/**
 * A minimal provider for testing the composition model.
 * Capabilities are just the object you pass in.
 */
export class StubProvider<T extends object = object> implements Provider<T> {
  constructor(
    public readonly name: string,
    private readonly caps: T,
  ) {}

  capabilities(): T {
    return this.caps
  }
}

/**
 * Build the dev environment ExoRunner with all providers wired up.
 *
 * For now this uses stubs. As providers are built, they replace stubs here.
 */
export function createDevRunner(): ExoRunner {
  const runner = new ExoRunner()

  // Builtin providers will be wired here as they're built:
  // runner.use('storage', new StorageProvider({ root: '.exoagent' }))
  // runner.use('sandbox', new SandboxProvider({ ... }))
  // runner.use('pi', new PiProvider({ ... }))
  // runner.use('review', new ReviewProvider({ ... }))
  // runner.use('secrets', new SecretsProvider({ ... }))

  return runner
}
