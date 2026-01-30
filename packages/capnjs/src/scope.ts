import type * as acorn from 'acorn'
import type { SafeEvalValueInternal, StubInternal } from './utils'
import { assertSafeMember, evalInvariant, isPlainObject, isStub, parseInvariant } from './utils'

export abstract class Scope {
  abstract get(node: acorn.Identifier): SafeEvalValueInternal | undefined
  abstract set(name: acorn.Identifier, value: SafeEvalValueInternal): any
  bind(param: acorn.Pattern, value: SafeEvalValueInternal, evaluate: (node: acorn.Expression, scope: Scope) => SafeEvalValueInternal) {
    parseInvariant(param.type !== 'MemberExpression', 'Member assignment is not allowed', param)

    if (param.type === 'Identifier') {
      this.set(param, value)
    }
    else if (param.type === 'AssignmentPattern') {
      let rhs: SafeEvalValueInternal = value
      if (rhs === undefined) {
        rhs = evaluate(param.right, this)
      }
      this.bind(param.left, rhs, evaluate)
    }
    else if (param.type === 'ArrayPattern') {
      evalInvariant(Array.isArray(value), 'Array pattern expects an array', param, value)
      for (const [i, pat] of param.elements.entries()) {
        if (pat === null) {
          continue
        }
        if (pat.type === 'RestElement') {
          parseInvariant(param.elements.length === i + 1, 'Rest element must be last', pat)
          this.bind(pat, value.slice(i), evaluate)
        }
        this.bind(pat, value[i], evaluate)
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
          key = evaluate(property.key, this)
        }
        else {
          parseInvariant(property.key.type === 'Identifier', 'Property key must be an identifier', property.key)
          key = property.key.name
        }
        // it isn't really necessary to check this here since we're saving to a `Map`, but for consistency
        // we'll do it anyway:
        assertSafeMember(key, property.key)
        this.bind(property.value, value[key as keyof typeof value] as SafeEvalValueInternal, evaluate)
        bound.add(key)
      }
    }
    else if (param.type === 'RestElement') {
      evalInvariant(Array.isArray(value), 'Rest element must evaluate to an array', param, value)
      this.bind(param.argument, value, evaluate)
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

  get(node: acorn.Identifier): SafeEvalValueInternal | undefined {
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

  get(node: acorn.Identifier): SafeEvalValueInternal | undefined {
    assertSafeMember(node.name, node)
    return this.vars.get(node.name) ?? this.parent?.get(node)
  }

  set(name: acorn.Identifier, value: SafeEvalValueInternal) {
    evalInvariant(!this.vars.has(name.name), 'Variable already bound', name, name.name)
    this.vars.set(name.name, value)
  }
}
