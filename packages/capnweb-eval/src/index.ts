import type { RpcStub } from 'capnweb'
import type { SafeEvalValue } from './utils'
import * as acorn from 'acorn'
import { evaluate } from './evaluate'
import { GlobalScope } from './scope'

export const safeEval = (code: string, globalThis: RpcStub<object>): SafeEvalValue => {
  const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: 'latest' })
  return evaluate(ast, new GlobalScope(globalThis)) as SafeEvalValue
}
