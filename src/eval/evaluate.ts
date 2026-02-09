import type * as acorn from 'acorn'
import type { Scope } from './scope'
import type { AwaitControl, SafeEvalValueInner, ValueOptions } from './utils'
import { LocalScope } from './scope'
import { emitAwaitControl, Invariant, Value } from './utils'

export type Evaluation<T> = Generator<AwaitControl, T, Value<SafeEvalValueInner>>

type StatementResult = {
  control: 'return'
  value?: Value<SafeEvalValueInner>
} | {
  control: 'normal'
}

export type DoStubCall = (options: ValueOptions, method: Value<(...args: any[]) => any>, thisVal: Value<SafeEvalValueInner>, args: Value<SafeEvalValueInner>[]) => Value<SafeEvalValueInner>

export class Evaluator {
  private doStubCall: DoStubCall
  private inv: Invariant

  constructor(code: string, doStubCall: DoStubCall) {
    this.inv = new Invariant(code)
    this.doStubCall = doStubCall
  }

  * evalPropertyKey(
    node: acorn.Expression,
    computed: boolean,
    scope: Scope,
  ): Evaluation<Value<string | number>> {
    if (computed) {
      const prop = yield* this.evaluate(node, scope)
      this.inv.eval(prop.isSafeMember(), 'Member must be a safe string or number', node, prop)
      return prop
    }
    this.inv.parse(node.type === 'Identifier', 'Property must be an identifier', node)
    const prop = Value.of(node.name, [])
    this.inv.eval(prop.isSafeMember(), 'Member must be a safe string or number', node, prop)
    return prop
  }

  * evalMemberExpression(
    node: acorn.MemberExpression,
    scope: Scope,
  ): Evaluation<{ object: Value<SafeEvalValueInner>, prop: Value<string | number> }> {
    this.inv.parse(node.object.type !== 'Super', '`super` is not allowed', node)
    this.inv.parse(
      node.property.type !== 'PrivateIdentifier',
      'Private identifiers are not allowed',
      node,
    )

    const object = yield* this.evaluate(node.object, scope)

    const prop = yield* this.evalPropertyKey(node.property, node.computed, scope)
    return { object, prop }
  }

  * evalArray(
    args: (acorn.Expression | acorn.SpreadElement | null)[],
    scope: Scope,
  ): Evaluation<Value<SafeEvalValueInner>[]> {
    const result: Value<SafeEvalValueInner>[] = []
    for (const arg of args) {
      if (arg === null) {
        continue
      }
      if (arg.type === 'SpreadElement') {
        const res = yield* this.evaluate(arg.argument, scope)
        this.inv.eval(res.isArray(), 'Spread syntax requires ... iterable to be an array', arg.argument, res)
        result.push(...res.raw)
      }
      else {
        result.push(yield* this.evaluate(arg, scope))
      }
    }
    return result
  }

  * evalStatement(
    node: acorn.Statement,
    scope: Scope,
  ): Evaluation<StatementResult> {
    if (node.type === 'BlockStatement') {
      const localScope = new LocalScope(new Map(), scope)
      for (const statement of node.body) {
        const result = yield* this.evalStatement(statement, localScope)
        if (result.control === 'return') {
          return result
        }
      }
      return { control: 'normal' }
    }
    else if (node.type === 'ReturnStatement') {
      const value = node.argument == null ? undefined : (yield* this.evaluate(node.argument, scope))
      return { control: 'return', value }
    }
    else if (node.type === 'VariableDeclaration') {
      this.inv.parse(node.kind === 'const', 'Only `const` declarations are allowed', node)
      for (const declaration of node.declarations) {
        this.inv.parse(declaration.init != null, 'Variable declarations must have an initializer', declaration)
        const value = yield* this.evaluate(declaration.init, scope)
        yield* scope.bind(declaration.id, value, this.evaluate.bind(this))
      }
      return { control: 'normal' }
    }
    else if (node.type === 'ExpressionStatement') {
      yield* this.evaluate(node.expression, scope)
      return { control: 'normal' }
    }
    else if (node.type === 'EmptyStatement') {
      return { control: 'normal' }
    }
    else {
      this.inv.parse(false, 'Unsupported statement', node)
    }
  }

  * evaluate(
    node: acorn.Expression,
    scope: Scope,
  ): Evaluation<Value<SafeEvalValueInner>> {
    if (node.type === 'Identifier') {
      const val = (yield* scope.get(node))
      if (val == null) {
        this.inv.parse(false, 'Identifier not found in scope', node)
      }
      return val
    }
    else if (node.type === 'Literal') {
      this.inv.eval(!(node.value instanceof RegExp), 'RegExp literals are not allowed', node, node.value)
      return Value.of(node.value, [])
    }
    else if (node.type === 'MemberExpression') {
      const { object, prop } = yield* this.evalMemberExpression(node, scope)
      this.inv.eval(prop.isSafeMember(), 'Member must be a safe string or number', node.property, prop)
      return object.getSlot(prop)
    }
    else if (node.type === 'CallExpression') {
      this.inv.parse(
        node.callee.type !== 'Super',
        '`super` is not allowed',
        node,
      )
      let object: Value<SafeEvalValueInner>
      let callee: Value<SafeEvalValueInner>
      if (node.callee.type === 'MemberExpression') {
        const { object: obj, prop } = yield* this.evalMemberExpression(node.callee, scope)
        object = obj
        callee = object.getSlot(prop)
      }
      else {
        object = Value.of(undefined, [])
        callee = yield* this.evaluate(node.callee, scope)
      }
      const args = yield* this.evalArray(node.arguments, scope)
      this.inv.eval(callee.isFunction(), 'Member must be a function', node.callee, callee)

      // TODO (security): we need to ensure that calling functions is only
      //         allowed if either:
      //          - the function is a @tool
      //          - the function is defined in the evaluation context
      if (!callee.options.isInternalFunction) {
        // If we're calling a method outside of the evaluation context, use doStubCall
        // which handles policy checks and taint propagation:
        // TODO: ensure this works for promises too
        this.inv.eval(callee.options.propertyName != null, 'Method must have a name', node.callee, callee)
        console.log('callee', callee, callee.options, object, args)
        return this.doStubCall(callee.options, callee, object, args)
      }
      else {
        // TODO: ensure this works for promises too:
        const result = Reflect.apply(callee.raw, object, args)
        return Value.of(result, callee.getTaints())
      }
    }
    else if (node.type === 'ArrayExpression') {
      const res = yield* this.evalArray(node.elements, scope)
      return Value.of(res, Value.mergeTaints(...res))
    }
    else if (node.type === 'ObjectExpression') {
      const result: { [key: string]: Value<SafeEvalValueInner> } = {}
      for (const property of node.properties) {
        if (property.type === 'SpreadElement') {
          const res = yield* this.evaluate(property.argument, scope)
          this.inv.eval(res.isPlainObject() || res.isArray(), 'Spread syntax requires ... iterable to be a plain object or array', property.argument, res)
          for (const [key, val] of Object.entries(res.raw)) {
            result[key] = val
          }
        }
        else {
          this.inv.parse(
            property.kind === 'init',
            'Disallowed property kind',
            property,
          )
          this.inv.parse(
            !property.shorthand,
            'Shorthand properties are not allowed',
            property,
          )
          this.inv.parse(
            !property.method,
            'Property methods not allowed (use function expressions instead)',
            property,
          )

          const keyVal = yield* this.evalPropertyKey(property.key, property.computed, scope)
          this.inv.eval(keyVal.isSafeMember(), 'Member must be a safe string or number', property.key, keyVal)
          result[keyVal.raw] = yield* this.evaluate(property.value, scope)
        }
      }
      return Value.of(result, Value.mergeTaints(...Object.values(result)))
    }
    else if (node.type === 'AwaitExpression') {
      const promise = yield* this.evaluate(node.argument, scope)
      const resolved = yield emitAwaitControl(promise, node)
      return resolved
    }
    else if (node.type === 'ArrowFunctionExpression') {
      this.inv.parse(
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
            const iter = this.evalFunctionBody(node, scope, args)
            let step = iter.next()
            while (!step.done) {
              step = iter.next(await step.value.value)
            }
            return step.value
          },
          [],
          { isInternalFunction: true },
        )
      }
      else {
        return Value.of(
          (...args: Value<SafeEvalValueInner>[]): Value<SafeEvalValueInner> => {
            const iter = this.evalFunctionBody(node, scope, args)
            const step = iter.next()
            this.inv.parse(step.done === true, '`await` must be used in an async function', node)
            return step.value
          },
          [],
          { isInternalFunction: true },
        )
      }
    }
    else if (node.type === 'UnaryExpression') {
      this.inv.parse(node.operator === '-', 'Only unary minus is supported', node)
      this.inv.parse(node.prefix, 'Postfix unary expressions are not supported', node)
      const value = yield* this.evaluate(node.argument, scope)
      this.inv.eval(value.isNumber(), 'Unary minus requires a number', node, value)
      return Value.of(-value.raw, value.getTaints())
    }
    else {
      this.inv.parse(false, 'Unsupported expression', node)
    }
  }

  * evalFunctionBody(node: acorn.ArrowFunctionExpression, scope: Scope, args: Value<SafeEvalValueInner>[]): Evaluation<Value<SafeEvalValueInner>> {
    const localScope = new LocalScope(new Map(), scope)
    for (const [i, param] of node.params.entries()) {
      yield* localScope.bind(param, args[i], this.evaluate.bind(this))
    }
    const { body } = node
    if (body.type === 'BlockStatement') {
      // We don't call `evaluateStatement` directly to avoid
      // creating a new scope:
      for (const statement of body.body) {
        const result = yield* this.evalStatement(statement, localScope)
        if (result.control === 'return') {
          return result.value ?? Value.of(undefined, [])
        }
      }
      return Value.of(undefined, [])
    }
    return yield* this.evaluate(body, localScope)
  }
}
