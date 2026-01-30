import type * as acorn from 'acorn'
import type { Scope } from './scope'
import type { SafeEvalHasMemberInternal, SafeEvalValueInternal } from './utils'
import { LocalScope } from './scope'
import { assertSafeMember, evalInvariant, isPlainObject, isStub, parseInvariant } from './utils'

type AwaitControl = { [controlAwaitSymbol]: 'await', value: SafeEvalValueInternal | Promise<SafeEvalValueInternal>, node: acorn.Expression }

export type Evaluation<T> = Generator<AwaitControl, T, SafeEvalValueInternal>

const controlAwaitSymbol = Symbol('controlAwait')
const emitAwaitControl = (value: SafeEvalValueInternal, node: acorn.Expression): AwaitControl => {
  return { [controlAwaitSymbol]: 'await', value, node }
}

function* evalPropertyKey(
  node: acorn.Expression,
  computed: boolean,
  scope: Scope,
): Evaluation<string | number> {
  let prop: unknown
  if (computed) {
    prop = yield* evaluate(node, scope)
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

function* evalMemberExpression(
  node: acorn.MemberExpression,
  scope: Scope,
): Evaluation<{ object: SafeEvalHasMemberInternal, prop: string | number }> {
  parseInvariant(node.object.type !== 'Super', '`super` is not allowed', node)
  parseInvariant(
    node.property.type !== 'PrivateIdentifier',
    'Private identifiers are not allowed',
    node,
  )

  const object = yield* evaluate(node.object, scope)
  evalInvariant(
    // TODO: `typeof object === 'function'` is a hack to allow stubs to be used as objects
    //    DO NOT SUBMIT THIS CHANGE
    (typeof object === 'object' || typeof object === 'function') && object !== null,
    `Object must evaluate to an object`,
    node,
    object,
  )

  const prop = yield* evalPropertyKey(node.property, node.computed, scope)
  if (Array.isArray(object) || typeof object === 'string') {
    evalInvariant(typeof prop === 'number', 'Index must be a number', node, prop)
  }
  else {
    evalInvariant(isPlainObject(object) || isStub(object), 'Object must evaluate to an object', node, object)
  }
  return { object, prop }
}

function* evalArray(
  args: (acorn.Expression | acorn.SpreadElement | null)[],
  scope: Scope,
): Evaluation<SafeEvalValueInternal[]> {
  const result: SafeEvalValueInternal[] = []
  for (const arg of args) {
    if (arg === null) {
      continue
    }
    if (arg.type === 'SpreadElement') {
      const res = yield* evaluate(arg.argument, scope)
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
      result.push(yield* evaluate(arg, scope))
    }
  }
  return result
}

type StatementResult = {
  control: 'return'
  value?: SafeEvalValueInternal
} | {
  control: 'normal'
}

function* evalStatement(
  node: acorn.Statement,
  scope: Scope,
): Evaluation<StatementResult> {
  if (node.type === 'BlockStatement') {
    const localScope = new LocalScope(new Map(), scope)
    for (const statement of node.body) {
      const result = yield* evalStatement(statement, localScope)
      if (result.control === 'return') {
        return result
      }
    }
    return { control: 'normal' }
  }
  else if (node.type === 'ReturnStatement') {
    const value = node.argument == null ? undefined : (yield* evaluate(node.argument, scope))
    return { control: 'return', value }
  }
  else if (node.type === 'VariableDeclaration') {
    parseInvariant(node.kind === 'const', 'Only `const` declarations are allowed', node)
    for (const declaration of node.declarations) {
      parseInvariant(declaration.init != null, 'Variable declarations must have an initializer', declaration)
      const value = yield* evaluate(declaration.init, scope)
      yield* scope.bind(declaration.id, value, evaluate)
    }
    return { control: 'normal' }
  }
  else if (node.type === 'ExpressionStatement') {
    yield* evaluate(node.expression, scope)
    return { control: 'normal' }
  }
  else if (node.type === 'EmptyStatement') {
    return { control: 'normal' }
  }
  else {
    parseInvariant(false, 'Unsupported statement', node)
  }
}

export function* evaluate(
  node: acorn.Expression,
  scope: Scope,
): Evaluation<SafeEvalValueInternal> {
  if (node.type === 'Identifier') {
    return (yield* scope.get(node))
  }
  else if (node.type === 'Literal') {
    evalInvariant(!(node.value instanceof RegExp), 'RegExp literals are not allowed', node, node.value)
    return node.value
  }
  else if (node.type === 'MemberExpression') {
    const { object, prop } = yield* evalMemberExpression(node, scope)
    return object[prop as keyof SafeEvalHasMemberInternal]
  }
  else if (node.type === 'CallExpression') {
    parseInvariant(
      node.callee.type !== 'Super',
      '`super` is not allowed',
      node,
    )
    if (node.callee.type === 'MemberExpression') {
      const { object, prop } = yield* evalMemberExpression(node.callee, scope)
      const args = yield* evalArray(node.arguments, scope)
      return (object[prop as keyof SafeEvalHasMemberInternal] as any)(...args)
    }
    const callee = yield* evaluate(node.callee, scope)
    const args = yield* evalArray(node.arguments, scope)
    return (callee as any)(...args)
  }
  else if (node.type === 'ArrayExpression') {
    return yield* evalArray(node.elements, scope)
  }
  else if (node.type === 'ObjectExpression') {
    const result: { [key: string]: SafeEvalValueInternal } = {}
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        const res = yield* evaluate(property.argument, scope)
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

        const key = yield* evalPropertyKey(property.key, property.computed, scope)
        result[key] = yield* evaluate(property.value, scope)
      }
    }
    return result
  }
  else if (node.type === 'AwaitExpression') {
    const promise = yield* evaluate(node.argument, scope)
    const resolved = yield emitAwaitControl(promise, node);
    return resolved
  }
  else if (node.type === 'ArrowFunctionExpression') {
    parseInvariant(
      !node.generator,
      'Generator functions are not allowed',
      node,
    )

    if (node.async) {
      return async (...args: SafeEvalValueInternal[]): Promise<SafeEvalValueInternal> => {
        const iter = evalFunctionBody(node, scope, args)
        let step = iter.next()
        while (!step.done) {
          step = iter.next(await step.value.value)
        }
        return step.value
      }
    }
    else {
      return (...args: SafeEvalValueInternal[]): SafeEvalValueInternal => {
        const iter = evalFunctionBody(node, scope, args)
        const step = iter.next()
        parseInvariant(step.done === true, '`await` must be used in an async function', node)
        return step.value
      }
    }
  }
  else if (node.type === 'UnaryExpression') {
    parseInvariant(node.operator === '-', 'Only unary minus is supported', node)
    parseInvariant(node.prefix, 'Postfix unary expressions are not supported', node)
    const value = yield* evaluate(node.argument, scope)
    evalInvariant(typeof value === 'number', 'Unary minus requires a number', node, value)
    return -value
  }
  else {
    parseInvariant(false, 'Unsupported expression', node)
  }
}

function* evalFunctionBody(node: acorn.ArrowFunctionExpression, scope: Scope, args: SafeEvalValueInternal[]): Evaluation<SafeEvalValueInternal> {
  const localScope = new LocalScope(new Map(), scope)
  for (const [i, param] of node.params.entries()) {
    yield* localScope.bind(param, args[i], evaluate)
  }
  const { body } = node
  if (body.type === 'BlockStatement') {
    // We don't call `evaluateStatement` directly to avoid
    // creating a new scope:
    for (const statement of body.body) {
      const result = yield* evalStatement(statement, localScope)
      if (result.control === 'return') {
        return result.value
      }
    }
    return
  }
  return yield* evaluate(body, localScope)
}
