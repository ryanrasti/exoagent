// capnweb-eval implementation for CodeMode
// This provides a SafeEvalContext that uses capnweb-eval for safe expression evaluation

import type { RpcTarget } from 'capnweb'
import type { SafeEvalContext } from './code-mode.js'
import { RpcStub } from 'capnweb'
import { safeEval } from 'capnweb-eval'

/**
 * Creates a SafeEvalContext that uses capnweb-eval for safe expression evaluation.
 * This evaluates code locally using capnweb-eval, passing the API as the global scope.
 *
 * @returns A SafeEvalContext configured for capnweb-eval
 */
export function createEvalSandbox<R>(): SafeEvalContext<R> {
  return {
    kind: 'passthrough',
    safeEval: async (code: string, api: RpcTarget): Promise<R> => {
      // Wrap the RpcTarget in an RpcStub to use as global scope
      const stub = new RpcStub(api)
      const fn = await safeEval(code)
      console.log('fn', fn)
      return (fn as any)(stub) as unknown as R
    },
  }
}
