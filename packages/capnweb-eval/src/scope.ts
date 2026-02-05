import type * as acorn from 'acorn'
import type { Evaluation } from './evaluate'
import type { SafeEvalValueInner, StubInternal } from './utils'
import { assertSafeMember, evalInvariant, parseInvariant, Value } from './utils'

export type EvaluateFn = (node: acorn.Expression, scope: Scope) => Evaluation<Value<SafeEvalValueInner>>

export abstract class Scope {
  abstract get(node: acorn.Identifier): Evaluation<Value<SafeEvalValueInner> | undefined>
  abstract set(name: acorn.Identifier, value: Value<SafeEvalValueInner>): void
  /** Taints from the execution path that led here (e.g. condition). Merged into values when binding. */
  getContextTaints(): string[] { return [] }

  /** Value with scope context taints merged in (for storing in this scope). */
  withContextTaints(value: Value<SafeEvalValueInner>): Value<SafeEvalValueInner> {
    if (!(value instanceof Value))
      return Value.of(value as SafeEvalValueInner, []) as Value<SafeEvalValueInner>
    return value.withTaints(this.getContextTaints()) as Value<SafeEvalValueInner>
  }

  * bind(param: acorn.Pattern, value: Value<SafeEvalValueInner>, evaluate: EvaluateFn): Evaluation<void> {
    parseInvariant(param.type !== 'MemberExpression', 'Member assignment is not allowed', param)
    const v = this.withContextTaints(value)

    if (param.type === 'Identifier') {
      this.set(param, v)
    }
    else if (param.type === 'AssignmentPattern') {
      let rhs: Value<SafeEvalValueInner> = value
      if (rhs.raw === undefined) {
        rhs = yield* evaluate(param.right, this)
      }
      yield* this.bind(param.left, rhs, evaluate)
    }
    else if (param.type === 'ArrayPattern') {
      evalInvariant(value.isArray(), 'Array pattern expects an array', param, value)
      const arr = value.raw
      for (const [i, pat] of param.elements.entries()) {
        if (pat === null) {
          continue
        }
        if (pat.type === 'RestElement') {
          parseInvariant(param.elements.length === i + 1, 'Rest element must be last', pat)
          yield* this.bind(pat, Value.of(arr.slice(i), Value.mergeTaints(...arr.slice(i))), evaluate)
        }
        else {
          yield* this.bind(pat, arr[i]!, evaluate)
        }
      }
    }
    else if (param.type === 'ObjectPattern') {
      evalInvariant(value.isPlainObject() || value.isArray(), 'Object pattern must evaluate to an object or array', param, value)

      const bound: Set<string | number> = new Set()
      for (const [i, property] of param.properties.entries()) {
        if (property.type === 'RestElement') {
          evalInvariant(!value.isStub(), 'Rest element must cannot be a stub', param, value)
          parseInvariant(property.argument.type === 'Identifier', 'Rest element must be an identifier', property.argument)
          parseInvariant(param.properties.length === i + 1, 'Rest element must be last', property.argument)
          const copy: { [key: string]: Value<SafeEvalValueInner> } = {}
          for (const key of Object.keys(value.raw)) {
            if (bound.has(key)) {
              continue
            }
            copy[key] = value.getSlot(Value.of(key, []))
          }
          this.set(property.argument, Value.of(copy, Value.mergeTaints(...Object.values(copy))))
          break
        }
        let key: Value<SafeEvalValueInner>
        if (property.computed) {
          key = yield* evaluate(property.key, this)
        }
        else {
          parseInvariant(property.key.type === 'Identifier', 'Property key must be an identifier', property.key)
          key = Value.of(property.key.name, [])
        }
        evalInvariant(key.isSafeMember(), 'Member must be a safe string or number', property.key, key)
        yield* this.bind(property.value, value.getSlot(key), evaluate)
        bound.add(key.raw)
      }
    }
    else if (param.type === 'RestElement') {
      evalInvariant(value.isArray(), 'Rest element must evaluate to an array', param, value)
      yield* this.bind(param.argument, value, evaluate)
    }
    else {
      parseInvariant(false, 'Invalid pattern', param)
    }
  }
}

export class GlobalScope extends Scope {
  constructor(public globalThis: StubInternal) {
    super()
  }

  * get(node: acorn.Identifier): Evaluation<Value<SafeEvalValueInner> | undefined> {
    assertSafeMember(node.name, node)
    const inner = this.globalThis[node.name]
    if (inner === undefined)
      return undefined
    return Value.of(inner, []) as Value<SafeEvalValueInner>
  }

  set(name: acorn.Identifier, value: Value<SafeEvalValueInner>) {
    evalInvariant(false, 'Global scope is read-only', name, value)
  }
}

export class LocalScope extends Scope {
  constructor(public vars: Map<string, Value<SafeEvalValueInner>>, public parent: Scope | null) {
    super()
  }

  * get(node: acorn.Identifier): Evaluation<Value<SafeEvalValueInner> | undefined> {
    assertSafeMember(node.name, node)
    const local = this.vars.get(node.name)
    if (local !== undefined)
      return local
    if (this.parent != null)
      return (yield* this.parent.get(node))
    return undefined
  }

  set(name: acorn.Identifier, value: Value<SafeEvalValueInner>) {
    evalInvariant(!this.vars.has(name.name), 'Variable already bound', name, name.name)
    this.vars.set(name.name, value)
  }
}
