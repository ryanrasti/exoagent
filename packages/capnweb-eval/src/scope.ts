import type * as acorn from 'acorn'
import type { SafeEvalValueInternal, StubInternal } from './utils'
import { assertSafeMember, evalInvariant, isPlainObject, isStub, parseInvariant } from './utils'
import type { Evaluation } from './evaluate'


export type EvaluateFn = (node: acorn.Expression, scope: Scope) => Evaluation<SafeEvalValueInternal>

export abstract class Scope {
  abstract get(node: acorn.Identifier): Evaluation<SafeEvalValueInternal | undefined>
  abstract set(name: acorn.Identifier, value: SafeEvalValueInternal): void

  * bind(param: acorn.Pattern, value: SafeEvalValueInternal, evaluate: EvaluateFn): Evaluation<void> {
    parseInvariant(param.type !== 'MemberExpression', 'Member assignment is not allowed', param)

    if (param.type === 'Identifier') {
      this.set(param, value)
    }
    else if (param.type === 'AssignmentPattern') {
      let rhs: SafeEvalValueInternal = value
      if (rhs === undefined) {
        rhs = yield* evaluate(param.right, this)
      }
      yield* this.bind(param.left, rhs, evaluate)
    }
    else if (param.type === 'ArrayPattern') {
      evalInvariant(Array.isArray(value), 'Array pattern expects an array', param, value)
      for (const [i, pat] of param.elements.entries()) {
        if (pat === null) {
          continue
        }
        if (pat.type === 'RestElement') {
          parseInvariant(param.elements.length === i + 1, 'Rest element must be last', pat)
          yield* this.bind(pat, value.slice(i), evaluate)
        }
        else {
          yield* this.bind(pat, value[i], evaluate)
        }
      }
    }
    else if (param.type === 'ObjectPattern') {
      evalInvariant(Array.isArray(value) || isPlainObject(value) || isStub(value), 'Object pattern must evaluate to an object or array', param, value)

      const bound: Set<string | number> = new Set()
      for (const [i, property] of param.properties.entries()) {
        if (property.type === 'RestElement') {
          evalInvariant(!isStub(value), 'Rest element must cannot be a stub', param, value)
          parseInvariant(property.argument.type === 'Identifier', 'Rest element must be an identifier', property.argument)
          parseInvariant(param.properties.length === i + 1, 'Rest element must be last', property.argument)
          const copy: { [key: string]: SafeEvalValueInternal } = {}
          for (const key of Object.keys(value)) {
            if (bound.has(key)) {
              continue
            }
            assertSafeMember(key, property)
            copy[key] = value[key]
          }
          this.set(property.argument, copy)
          break
        }
        let key: SafeEvalValueInternal
        if (property.computed) {
          key = yield* evaluate(property.key, this)
        }
        else {
          parseInvariant(property.key.type === 'Identifier', 'Property key must be an identifier', property.key)
          key = property.key.name
        }
        assertSafeMember(key, property.key)
        yield* this.bind(property.value, value[key as keyof typeof value] as SafeEvalValueInternal, evaluate)
        bound.add(key)
      }
    }
    else if (param.type === 'RestElement') {
      evalInvariant(Array.isArray(value), 'Rest element must evaluate to an array', param, value)
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

  *get(node: acorn.Identifier): Evaluation<SafeEvalValueInternal | undefined> {
    assertSafeMember(node.name, node)
    return this.globalThis[node.name as keyof StubInternal]
  }

  set(name: acorn.Identifier, value: SafeEvalValueInternal) {
    evalInvariant(false, 'Global scope is read-only', name, value)
  }
}

export class LocalScope extends Scope {
  constructor(public vars: Map<string, SafeEvalValueInternal>, public parent: Scope | null) {
    super()
  }

  *get(node: acorn.Identifier): Evaluation<SafeEvalValueInternal | undefined> {
    assertSafeMember(node.name, node)
    const local = this.vars.get(node.name)
    if (local !== undefined)
      return local
    if (this.parent != null)
      return (yield* this.parent.get(node))
    return undefined
  }

  set(name: acorn.Identifier, value: SafeEvalValueInternal) {
    evalInvariant(!this.vars.has(name.name), 'Variable already bound', name, name.name)
    this.vars.set(name.name, value)
  }
}
