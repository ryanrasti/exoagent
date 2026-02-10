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
    // Unwrap args (no policy check), call method, wrap result
    const unwrappedArgs = args.map(a => a.unwrap(() => {}))
    const rawResult = Reflect.apply(method.raw, thisVal.raw, unwrappedArgs)
    return Value.of(rawResult, Value.mergeTaints(thisVal, ...args))
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
