/**
 * Shared builtin toolset for agent control flow.
 *
 * Extends BuiltinFunctions to inherit taint-aware methods like `all`.
 * All methods use @tool from the provided ExoAgent for policy enforcement.
 */

import { z } from 'zod'
import type { ExoAgent } from '../policy'
import type { Value } from '../eval/utils'
import { BuiltinFunctions } from '../eval/builtins'

export interface BuiltinToolsetConfig {
  onRespond?: (msg: string) => void
  /** Receives a Value so taints can be extracted */
  onSetResult?: (result: Value) => void
}

/**
 * Create a BuiltinToolset class bound to a specific ExoAgent.
 *
 * This factory is needed because @tool decorators must reference a specific ExoAgent
 * instance, and we want to support different ExoAgent configurations.
 */
export function createBuiltinToolsetClass<
  Sources extends readonly string[],
  Sinks extends readonly string[],
>(exo: ExoAgent<Sources, Sinks>) {
  class BuiltinToolset extends BuiltinFunctions {
    private onRespond: (msg: string) => void
    private onSetResult: (result: Value) => void

    constructor(config: BuiltinToolsetConfig = {}) {
      super()
      this.onRespond = config.onRespond ?? (() => {})
      this.onSetResult = config.onSetResult ?? (() => {})
    }

    @exo.tool(z.string())
    respond(msg: string) {
      this.onRespond(msg)
    }

    @exo.tool(z.unknown(), { raw: true })
    setToolCallResult(result: Value) {
      this.onSetResult(result)
    }
  }

  return BuiltinToolset
}
