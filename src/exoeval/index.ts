import type * as acorn from 'acorn'
import type { ExpressionContext } from './expr'
import { parse } from 'acorn'
import { ExoArray, ExoBoolean, ExoDate, ExoJSON, ExoMath, ExoNumber, ExoObject, ExoString } from './builtins'
import { Evaluator } from './evaluator'
import { IdentityContext } from './expr'
import { Scope } from './scope'

export { asToolFn } from './tool'
export type { ToolFunction } from './tool'

const builtins: Record<string, unknown> = {
  Array: ExoArray,
  String: ExoString,
  Object: ExoObject,
  Date: ExoDate,
  Boolean: ExoBoolean,
  JSON: ExoJSON,
  Math: ExoMath,
  Number: ExoNumber,
}

export function exoEval(code: string): unknown
export function exoEval<T>(code: string, ctx: ExpressionContext<T>): T
export function exoEval(code: string, ctx = new IdentityContext()): unknown {
  const ast = parse(code, { ecmaVersion: 2022 })
  const rootScope = new Scope<unknown>(undefined)
  const evaluator = new Evaluator(ast, code, ctx, rootScope, {
    Array: ExoArray.prototype,
    String: ExoString.prototype,
    Date: ExoDate.prototype,
  })

  for (const [name, value] of Object.entries(builtins)) {
    rootScope.set(
      { type: 'Identifier', name, start: 0, end: 0 } as acorn.Identifier,
      ctx.of(value),
      evaluator,
    )
  }

  return evaluator.Program(ast)
}

export function exoFn<T extends (...args: any[]) => unknown>(fn: T): T {
  return exoEval(fn.toString()) as T
}
