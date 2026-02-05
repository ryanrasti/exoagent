import type * as acorn from 'acorn'
import type { Scope } from './scope'
import type { AwaitControl, SafeEvalValueInner } from './utils'
import { inspect } from 'node:util'
import { LocalScope } from './scope'
import { emitAwaitControl, evalInvariant, parseInvariant, Value } from './utils'

export type Evaluation<T> = Generator<AwaitControl, T, Value<SafeEvalValueInner>>

function* evalPropertyKey(
  node: acorn.Expression,
  computed: boolean,
  scope: Scope,
): Evaluation<Value<string | number>> {
  if (computed) {
    const prop = yield* evaluate(node, scope)
    evalInvariant(prop.isSafeMember(), 'Member must be a safe string or number', node, prop)
    return prop
  }
  parseInvariant(node.type === 'Identifier', 'Property must be an identifier', node)
  const prop = Value.of(node.name, [])
  evalInvariant(prop.isSafeMember(), 'Member must be a safe string or number', node, prop)
  return prop
}

function* evalMemberExpression(
  node: acorn.MemberExpression,
  scope: Scope,
): Evaluation<{ object: Value<SafeEvalValueInner>, prop: Value<string | number> }> {
  parseInvariant(node.object.type !== 'Super', '`super` is not allowed', node)
  parseInvariant(
    node.property.type !== 'PrivateIdentifier',
    'Private identifiers are not allowed',
    node,
  )

  const object = yield* evaluate(node.object, scope)
  evalInvariant(object.hasMembers(), 'Object must evaluate to an object', node, object)

  const prop = yield* evalPropertyKey(node.property, node.computed, scope)
  evalInvariant(prop.isSafeMember(), 'Member must be a safe string or number', node.property, prop)
  if (object.isArray() || object.isString()) {
    evalInvariant(prop.isNumber(), 'Index must be a number', node, prop)
  }
  else {
    evalInvariant(object.isPlainObject() || object.isStub(), 'Object must evaluate to an object', node, object)
  }
  return { object, prop }
}

function* evalArray(
  args: (acorn.Expression | acorn.SpreadElement | null)[],
  scope: Scope,
): Evaluation<Value<SafeEvalValueInner>[]> {
  const result: Value<SafeEvalValueInner>[] = []
  for (const arg of args) {
    if (arg === null) {
      continue
    }
    if (arg.type === 'SpreadElement') {
      const res = yield* evaluate(arg.argument, scope)
      evalInvariant(res.isArray(), 'Spread syntax requires ... iterable to be an array', arg.argument, res)
      result.push(...res.raw)
    }
    else {
      result.push(yield* evaluate(arg, scope))
    }
  }
  return result
}

type StatementResult = {
  control: 'return'
  value?: Value<SafeEvalValueInner>
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
): Evaluation<Value<SafeEvalValueInner>> {
  if (node.type === 'Identifier') {
    const val = (yield* scope.get(node))
    console.log('evaluate', node.name, inspect(val, { depth: null }))
    if (val == null) {
      parseInvariant(false, 'Identifier not found in scope', node)
    }
    return val
  }
  else if (node.type === 'Literal') {
    evalInvariant(!(node.value instanceof RegExp), 'RegExp literals are not allowed', node, node.value)
    return Value.of(node.value, [])
  }
  else if (node.type === 'MemberExpression') {
    const { object, prop } = yield* evalMemberExpression(node, scope)
    evalInvariant(prop.isSafeMember(), 'Member must be a safe string or number', node.property, prop)
    return object.getSlot(prop)
  }
  else if (node.type === 'CallExpression') {
    parseInvariant(
      node.callee.type !== 'Super',
      '`super` is not allowed',
      node,
    )
    let object: Value<SafeEvalValueInner>
    let callee: Value<SafeEvalValueInner>
    if (node.callee.type === 'MemberExpression') {
      const { object: obj, prop } = yield* evalMemberExpression(node.callee, scope)
      object = obj
      callee = object.getSlot(prop)
    }
    else {
      object = Value.of(undefined, [])
      callee = yield* evaluate(node.callee, scope)
    }
    const args = yield* evalArray(node.arguments, scope)
    evalInvariant(callee.isFunction(), 'Member must be a function', node.callee, callee)
    const method = callee.raw
    if (callee.isStub()) {
      // If we're calling a method outside of the evaluation context, it's a regular
      // JS call -- call it then re-wrap it:
      // TODO: ensure this works for promises too
      // TODO: do the actual policy check here
      const r = Reflect.apply(method, object.raw, args.map(a => a.raw))
      return Value.of(r, callee.getTaints()).withTaints(
        // Since we're calling a method outside of the evaluation context,
        //  we need to manually merge the taints from the arguments:
        args.flatMap(a => a.getTaints()),
      )
    }
    else {
      // TODO: ensure this works for promises too:
      const result = Reflect.apply(method, object, args)
      return result.withTaints(callee.getTaints())
    }
  }
  else if (node.type === 'ArrayExpression') {
    const res = yield* evalArray(node.elements, scope)
    return Value.of(res, Value.mergeTaints(...res))
  }
  else if (node.type === 'ObjectExpression') {
    const result: { [key: string]: Value<SafeEvalValueInner> } = {}
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        const res = yield* evaluate(property.argument, scope)
        evalInvariant(res.isPlainObject() || res.isArray(), 'Spread syntax requires ... iterable to be a plain object or array', property.argument, res)
        for (const [key, val] of Object.entries(res.raw)) {
          result[key] = val
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

        const keyVal = yield* evalPropertyKey(property.key, property.computed, scope)
        evalInvariant(keyVal.isSafeMember(), 'Member must be a safe string or number', property.key, keyVal)
        result[keyVal.raw] = yield* evaluate(property.value, scope)
      }
    }
    return Value.of(result, Value.mergeTaints(...Object.values(result)))
  }
  else if (node.type === 'AwaitExpression') {
    const promise = yield* evaluate(node.argument, scope)
    const resolved = yield emitAwaitControl(promise, node)
    return resolved
  }
  else if (node.type === 'ArrowFunctionExpression') {
    parseInvariant(
      !node.generator,
      'Generator functions are not allowed',
      node,
    )

    // TODO: when we start checking policy, these function need to somehow
    //         check the current policy against their return values
    //         alternative is to capture taints from the closure scope
    if (node.async) {
      return Value.of(
        async (...args: Value<SafeEvalValueInner>[]): Promise<Value<SafeEvalValueInner>> => {
          const iter = evalFunctionBody(node, scope, args)
          let step = iter.next()
          while (!step.done) {
            step = iter.next(await step.value.value)
          }
          return step.value
        },
        [],
      )
    }
    else {
      return Value.of(
        (...args: Value<SafeEvalValueInner>[]): Value<SafeEvalValueInner> => {
          const iter = evalFunctionBody(node, scope, args)
          const step = iter.next()
          parseInvariant(step.done === true, '`await` must be used in an async function', node)
          return step.value
        },
        [],
      )
    }
  }
  else if (node.type === 'UnaryExpression') {
    parseInvariant(node.operator === '-', 'Only unary minus is supported', node)
    parseInvariant(node.prefix, 'Postfix unary expressions are not supported', node)
    const value = yield* evaluate(node.argument, scope)
    evalInvariant(value.isNumber(), 'Unary minus requires a number', node, value)
    return Value.of(-value.raw, value.getTaints())
  }
  else {
    parseInvariant(false, 'Unsupported expression', node)
  }
}

function* evalFunctionBody(node: acorn.ArrowFunctionExpression, scope: Scope, args: Value<SafeEvalValueInner>[]): Evaluation<Value<SafeEvalValueInner>> {
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
        return result.value ?? Value.of(undefined, [])
      }
    }
    return Value.of(undefined, [])
  }
  return yield* evaluate(body, localScope)
}
