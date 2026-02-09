import type { RpcTarget } from 'capnweb'
import type { DoStubCall } from './evaluate'
import type { SafeEvalValueInner } from './utils'
import * as acorn from 'acorn'
import { Evaluator } from './evaluate'
import { GlobalScope } from './scope'
import { Value } from './utils'

export { Evaluator } from './evaluate'
export { formatCodeMessage, Invariant, Value } from './utils'

export const safeEval = (code: string, globalThis?: Value, doStubCall?: DoStubCall): Value<SafeEvalValueInner> | PromiseLike<Value<SafeEvalValueInner>> => {
  const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: 'latest' })
  const evaluator = new Evaluator(code, doStubCall ?? ((options, method, thisVal, args) => {
    // Default: just call the stub without policy checks
    // TODO: default should probably deny, but for now allow:
    // TODO: what do do about `options`?
    return method.callStub(thisVal, args)
  }))
  const iter = evaluator.evaluate(ast, globalThis ? new GlobalScope(globalThis) : new GlobalScope(Value.of({}, [])))
  let step = iter.next()
  if (step.done) {
    return step.value.asAwaitable()
  }

  const fn = async (): Promise<Value<SafeEvalValueInner>> => {
    while (!step.done) {
      const ctrl = step.value as { value: Value<SafeEvalValueInner> | Promise<Value<SafeEvalValueInner>> }
      const raw = ctrl.value
      const resolved = raw instanceof Value
        ? (await raw.asAwaitable())
        : await raw
      step = iter.next(Value.of(resolved, []) as Value<SafeEvalValueInner>)
    }
    return step.value.asAwaitable()
  }
  return fn()
}
