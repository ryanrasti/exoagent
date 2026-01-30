import type { RpcStub } from 'capnweb'
import type { SafeEvalValue } from './utils'
import * as acorn from 'acorn'
import { evaluate, isAwaitControl } from './evaluate'
import { GlobalScope } from './scope'
import { evalInvariant } from './utils'

export const safeEval = (code: string, globalThis?: RpcStub<object>): SafeEvalValue | Promise<SafeEvalValue> => {
  const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: 'latest' })
  const iter = evaluate(ast, globalThis ? new GlobalScope(globalThis) : new GlobalScope({}))
  let step = iter.next()
  if (step.done) {
    return step.value as SafeEvalValue
  }

  // We're in an async function, so we need to return a promise and await the results:
  const fn = async (): Promise<SafeEvalValue> => {
    while (!step.done) {
      evalInvariant(isAwaitControl(step.value), 'Internal error: expected `await`, got raw value.', ast, step.value)
      await step.value.value
      step = iter.next()
    }
    return step.value as SafeEvalValue
  }
  return fn()
}
