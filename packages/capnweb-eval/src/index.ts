import type { RpcStub } from 'capnweb'
import type { CheckStubCall } from './evaluate'
import type { SafeEvalValueInner, StubInternal } from './utils'
import * as acorn from 'acorn'
import { Evaluator } from './evaluate'
import { GlobalScope } from './scope'
import { Value } from './utils'

export type { SafeEvalValueInner, Value } from './utils'

export const safeEval = (code: string, globalThis?: RpcStub<object>, checkStubCall?: CheckStubCall): Value<SafeEvalValueInner> | PromiseLike<Value<SafeEvalValueInner>> => {
  const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: 'latest' })
  const evaluator = new Evaluator(checkStubCall ?? (() => {
    // TODO: default allow, but should be deny:
    return { verdict: 'allow' }
  }))
  const iter = evaluator.evaluate(ast, globalThis ? new GlobalScope(globalThis as StubInternal) : new GlobalScope({}))
  let step = iter.next()
  if (step.done) {
    return step.value.asAwaitable()
  }

  const fn = async (): Promise<Value<SafeEvalValueInner>> => {
    while (!step.done) {
      const ctrl = step.value as { value: Value<SafeEvalValueInner> | Promise<Value<SafeEvalValueInner>> }
      const raw = ctrl.value
      const resolved = raw instanceof Value
        ? (raw.raw instanceof Promise ? await raw.raw : raw.raw)
        : await raw
      const innerOnly: SafeEvalValueInner = resolved instanceof Value ? (resolved as Value<SafeEvalValueInner>).raw : (resolved as SafeEvalValueInner)
      const taints = raw instanceof Value ? raw.getTaints() : Value.getTaints(resolved)
      step = iter.next(Value.of(innerOnly, taints) as Value<SafeEvalValueInner>)
    }
    return step.value.asAwaitable()
  }
  return fn()
}
