import type { DoStubCall } from './evaluate'
import type { Scope } from './scope'
import type { SafeEvalValueInner } from './utils'
import * as acorn from 'acorn'
import { Evaluator } from './evaluate'
import { GlobalScope } from './scope'
import { Value } from './utils'

export { Evaluator } from './evaluate'
export { GlobalScope, LocalScope, serializeScope, deserializeScope } from './scope'
export type { SerializedScope } from './scope'
export { formatCodeMessage, Invariant, Value, normalizeTaint, normalizeTaints } from './utils'
export type { Taint, TaintParams, TaintInput, TaintsInput, PolicyChecker } from './utils'

// Export builtins separately - must be imported AFTER policy is loaded
// to avoid circular dependency (builtins -> policy -> eval -> builtins)
export { ArrayValue, registerArrayValueFactory } from './builtins'

export const safeEval = (code: string, globalThis?: Value | Scope, doStubCall?: DoStubCall): Value<SafeEvalValueInner> | PromiseLike<Value<SafeEvalValueInner>> => {
  const defaultStubCall: DoStubCall = (_options, method, thisVal, args) => {
    // Default: just call the stub without policy checks
    // Unwrap args (no policy check), call method, wrap result
    const unwrappedArgs = args.map(a => a.unwrap(() => {}))
    const rawResult = Reflect.apply(method.raw, thisVal.raw, unwrappedArgs)
    return Value.of(rawResult, Value.mergeTaints(thisVal, ...args))
  }
  const evaluator = new Evaluator(code, doStubCall ?? defaultStubCall)
  const scope = globalThis instanceof Value
    ? new GlobalScope(globalThis)
    : globalThis ?? new GlobalScope(Value.of({}, []))

  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
  const iter = evaluator.evalStatements(ast.body, scope)

  let step = iter.next()
  if (step.done) {
    const val = step.value
    return (val instanceof Value ? val : Value.of(undefined, [])).asAwaitable()
  }

  const fn = async (): Promise<Value<SafeEvalValueInner>> => {
    while (!step.done) {
      const ctrl = step.value as { value: Value<SafeEvalValueInner> | Promise<Value<SafeEvalValueInner>> }
      const raw = ctrl.value
      const resolved = raw instanceof Value
        ? (await raw.asAwaitable())
        : await raw
      // If the resolved value is already a Value (e.g., from doStubCall), use it directly
      // Otherwise wrap it in a Value
      const valueToSend = resolved instanceof Value
        ? resolved
        : Value.of(resolved, [])
      step = iter.next(valueToSend as Value<SafeEvalValueInner>)
    }
    const val = step.value
    return (val instanceof Value ? val : Value.of(undefined, [])).asAwaitable()
  }
  return fn()
}
