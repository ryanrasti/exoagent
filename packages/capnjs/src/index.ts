import type { RpcStub } from 'capnweb'
import type { SafeEvalValueInternal } from './utils'
import * as acorn from 'acorn'
import { evaluate } from './evaluate'
import { GlobalScope } from './scope'

export const safeEval = (code: string, globalThis: RpcStub<object>): SafeEvalValueInternal => {
  const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: 'latest' })
  return evaluate(ast, new GlobalScope(globalThis))
}
