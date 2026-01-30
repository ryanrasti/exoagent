/* eslint-disable ts/no-use-before-define */
import type { RpcStub } from 'capnweb'
import type { Scope } from './scope'
import type { SafeEvalHasMemberInternal, SafeEvalValueInternal } from './utils'
import * as acorn from 'acorn'
import { GlobalScope, LocalScope } from './scope'
import { assertSafeMember, evalInvariant, isPlainObject, isStub, parseInvariant } from './utils'

export const safeEval = (code: string, globalThis: RpcStub<object>): SafeEvalValueInternal => {
  const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: 'latest' })
  return evaluate(ast, new GlobalScope(globalThis))
}

const evalPropertyKey = (
  node: acorn.Expression,
  computed: boolean,
  scope: Scope,
) => {
  let prop: unknown
  if (computed) {
    prop = evaluate(node, scope)
  }
  else {
    parseInvariant(
      node.type === 'Identifier',
      'Property must be an identifier',
      node,
    )
    prop = node.name
  }
  assertSafeMember(prop, node)
  return prop
}

const evalMemberExpression = (node: acorn.MemberExpression, scope: Scope): { object: SafeEvalHasMemberInternal, prop: string | number } => {
  parseInvariant(node.object.type !== 'Super', '`super` is not allowed', node)
  parseInvariant(
    node.property.type !== 'PrivateIdentifier',
    'Private identifiers are not allowed',
    node,
  )

  const object = evaluate(node.object, scope)
  evalInvariant(
    typeof object === 'object' && object !== null,
    `Object must evaluate to an object`,
    node,
    object,
  )

  const prop = evalPropertyKey(node.property, node.computed, scope)
  if (Array.isArray(object) || typeof object === 'string') {
    evalInvariant(typeof prop === 'number', 'Index must be a number', node, prop)
  }
  else {
    evalInvariant(isPlainObject(object) || isStub(object), 'Object must evaluate to an object', node, object)
  }
  return { object, prop }
}

const evalArray = (
  args: (acorn.Expression | acorn.SpreadElement | null)[],
  scope: Scope,
) => {
  const result: SafeEvalValueInternal[] = []
  for (const arg of args) {
    if (arg === null) {
      continue
    }
    if (arg.type === 'SpreadElement') {
      const res = evaluate(arg.argument, scope)
      // If we relax this to any iterable, just be careful about the `...` spread:
      evalInvariant(
        Array.isArray(res),
        'Spread syntax requires ... iterable to be an array',
        arg.argument,
        res,
      )
      result.push(...res)
    }
    else {
      result.push(evaluate(arg, scope))
    }
  }
  return result
}

type StatementResult = {
  control: 'return' | 'normal'
  value?: SafeEvalValueInternal
}

const evalStatement = (node: acorn.Statement, scope: Scope): StatementResult => {
  if (node.type === 'BlockStatement') {
    for (const statement of node.body) {
      const result = evalStatement(statement, scope)
      if (result.control === 'return') {
        return result
      }
    }
    return { control: 'normal' }
  }
  else if (node.type === 'ReturnStatement') {
    return { control: 'return', value: node.argument == null ? undefined : evaluate(node.argument, scope) }
  }
  else if (node.type === 'VariableDeclaration') {
    parseInvariant(node.kind === 'const', 'Only `const` declarations are allowed', node)
    for (const declaration of node.declarations) {
      parseInvariant(declaration.init != null, 'Variable declarations must have an initializer', declaration)
      const value = evaluate(declaration.init, scope)
      scope.bind(declaration.id, value, evaluate)
    }
    return { control: 'normal' }
  }
  else {
    parseInvariant(false, 'Invalid statement', node)
  }
}

export const evaluate = (node: acorn.Expression, scope: Scope): SafeEvalValueInternal => {
  if (node.type === 'Identifier') {
    return scope.get(node)
  }
  else if (node.type === 'Literal') {
    evalInvariant(!(node.value instanceof RegExp), 'RegExp literals are not allowed', node, node.value)
    return node.value
  }
  else if (node.type === 'MemberExpression') {
    const { object, prop } = evalMemberExpression(node, scope)
    return object[prop as keyof SafeEvalHasMemberInternal]
  }
  else if (node.type === 'CallExpression') {
    parseInvariant(
      node.callee.type !== 'Super',
      '`super` is not allowed',
      node,
    )
    if (node.callee.type === 'MemberExpression') {
      const { object, prop } = evalMemberExpression(node.callee, scope)
      const args = evalArray(node.arguments, scope)
      return (object[prop as keyof SafeEvalHasMemberInternal] as any)(...args)
    }
    const callee = evaluate(node.callee, scope)
    const args = evalArray(node.arguments, scope)
    return (callee as any)(...args)
  }
  else if (node.type === 'ArrayExpression') {
    return evalArray(node.elements, scope)
  }
  else if (node.type === 'ObjectExpression') {
    const result: { [key: string]: SafeEvalValueInternal } = {}
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        const res = evaluate(property.argument, scope)
        evalInvariant(
          isPlainObject(res) || Array.isArray(res),
          'Spread syntax requires ... iterable to be a plain object or array',
          property.argument,
          res,
        )
        for (const [key, value] of Object.entries(res)) {
          result[key] = value
        }
      }
      else {
        parseInvariant(
          property.kind === 'init',
          'Disallowed property kind',
          property,
        )
        parseInvariant(
          !property.shorthand,
          'Shorthand properties are not allowed',
          property,
        )
        parseInvariant(
          !property.method,
          'Property methods not allowed (use function expressions instead)',
          property,
        )

        const key = evalPropertyKey(property.key, property.computed, scope)
        result[key] = evaluate(property.value, scope)
      }
    }
    return result
  }
  else if (node.type === 'ArrowFunctionExpression') {
    parseInvariant(
      !node.async,
      'Async functions are not allowed',
      node,
    )
    parseInvariant(
      !node.generator,
      'Generator functions are not allowed',
      node,
    )
    parseInvariant(
      node.expression,
      'Arrow functions must be expressions',
      node,
    )

    return (...args: SafeEvalValueInternal[]) => {
      const localScope = new LocalScope(new Map(), scope)
      for (const [i, param] of node.params.entries()) {
        localScope.bind(param, args[i], evaluate)
      }
      if (node.body.type === 'BlockStatement') {
        const { value } = evalStatement(node.body, localScope)
        return value
      }
      return evaluate(node.body, localScope)
    }
  }
  else {
    parseInvariant(false, 'Unsupported expression', node)
  }
}
