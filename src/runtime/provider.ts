/**
 * A Provider is a class whose instantiations are capabilities (caps).
 *
 * Providers run in the daemon process (trusted, unsandboxed). They hold
 * secrets and make API calls. The environment layer (dev.ts) wires
 * provider classes to config/secrets and produces cap instances.
 *
 * Every public method/property on a cap must be decorated with @tool()
 * so exoeval can enforce access at the interpreter level.
 */
export interface Provider<TCaps extends object = object> {
  /** The @tool()-decorated capability object(s) this provider exposes. */
  capabilities: () => TCaps

  /** Optional cleanup. */
  close?: () => Promise<void>
}
