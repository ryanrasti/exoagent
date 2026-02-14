import type * as acorn from 'acorn'
import { generate } from 'astring'
import { Evaluator } from './evaluate'
import type { Evaluation } from './evaluate'
import type { SafeEvalValueInner, Taint } from './utils'
import { assertSafeMember, evalInvariant, parseInvariant, Value } from './utils'
import * as b from './ast'

export type EvaluateFn = (node: acorn.Expression, scope: Scope) => Evaluation<Value<SafeEvalValueInner>>

export abstract class Scope {
  abstract get(node: acorn.Identifier): Evaluation<Value<SafeEvalValueInner> | undefined>
  abstract set(name: acorn.Identifier, value: Value<SafeEvalValueInner>): void
  /** Taints from the execution path that led here (e.g. condition). Merged into values when binding. */
  getContextTaints(): Taint[] { return [] }

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
          yield* this.bind(pat, Value.of(arr.slice(i), Value.mergeTaints(...arr.slice(i)), { shallow: true }), evaluate)
        }
        else {
          yield* this.bind(pat, arr[i] ?? Value.of(undefined, []), evaluate)
        }
      }
    }
    else if (param.type === 'ObjectPattern') {
      evalInvariant(value.isPlainObject() || value.isArray() || value.isClassLike(), 'Object pattern must evaluate to an object or array', param, value)

      const bound: Set<string | number> = new Set()
      for (const [i, property] of param.properties.entries()) {
        if (property.type === 'RestElement') {
          evalInvariant(!value.isClassLike(), 'Rest element must cannot be a stub', param, value)
          parseInvariant(property.argument.type === 'Identifier', 'Rest element must be an identifier', property.argument)
          parseInvariant(param.properties.length === i + 1, 'Rest element must be last', property.argument)
          const copy: { [key: string]: Value<SafeEvalValueInner> } = {}
          for (const key of Object.keys(value.raw)) {
            if (bound.has(key)) {
              continue
            }
            copy[key] = value.getSlot(Value.of(key, []))
          }
          this.set(property.argument, Value.of(copy, Value.mergeTaints(...Object.values(copy)), { shallow: true }))
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

/** Reserved names that cannot be bound in a GlobalScope */
const RESERVED_NAMES = new Set(['Value'])

export class GlobalScope extends Scope {
  constructor(
    public globalThis: Value<{ [key: string]: Value }>,
    public readOnly: boolean = true,
  ) {
    super()
  }

  * get(node: acorn.Identifier): Evaluation<Value<SafeEvalValueInner> | undefined> {
    assertSafeMember(node.name, node)
    // TODO: `get` should actually accept a Value<string | number> so we
    //  can properly propagate taints
    return this.globalThis.getSlot(Value.of(node.name, []))
  }

  set(name: acorn.Identifier, value: Value<SafeEvalValueInner>) {
    if (this.readOnly) {
      evalInvariant(false, 'Global scope is read-only', name, value)
    }
    evalInvariant(!RESERVED_NAMES.has(name.name), `Cannot bind reserved name: ${name.name}`, name, name.name)
    assertSafeMember(name.name, name)
    const raw = this.globalThis.raw as { [key: string]: Value }
    evalInvariant(!(name.name in raw), 'Variable already bound', name, name.name)
    raw[name.name] = value
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

export type SerializedScope = {
  /** Debug-friendly code representation */
  code: string
  /** AST ready for evaluation */
  ast: acorn.Program
}

/**
 * Serialize a GlobalScope to AST + code.
 * The result can be used to reconstruct the scope.
 */
export function serializeScope(scope: GlobalScope): SerializedScope {
  const vars = scope.globalThis.raw as { [key: string]: Value<SafeEvalValueInner> }
  const declarations = Object.entries(vars).map(([name, value]) =>
    b.constDecl(name, value.toAST()),
  )

  const ast = b.program(declarations)
  const code = generate(ast)

  return { code, ast }
}

const noopChecker = () => {}

/**
 * Helper class for deserialization - unwraps Value args before calling Value.of
 */
class ScopeValue {
  static of(
    raw: Value<SafeEvalValueInner>,
    taints: Value<SafeEvalValueInner>,
  ): Value<SafeEvalValueInner> {
    // Unwrap taints, preserve the raw Value with its options (including fnNode for functions)
    const unwrappedTaints = taints.unwrap(noopChecker) as Taint[]
    return raw.withTaints(unwrappedTaints)
  }
}

/**
 * Deserialize a SerializedScope back into a GlobalScope.
 * Uses the evaluator with ScopeValue.of as a capability.
 */
export function deserializeScope(serialized: SerializedScope): GlobalScope {
  // Create temporary scope with Value.of available as a capability (via ScopeValue wrapper)
  const tempScope = new GlobalScope(
    Value.of({ Value: Value.of({ of: Value.of(ScopeValue.of, []) }, [], { shallow: true }) }, [], { shallow: true }),
    false,
  )

  const evaluator = new Evaluator('', (_options, method, _thisVal, args) => {
    // During deserialization, we only call ScopeValue.of - just invoke it directly
    const result = Reflect.apply(method.raw, undefined, args)
    return result instanceof Value ? result : Value.of(result, Value.mergeTaints(...args))
  })

  for (const stmt of serialized.ast.body) {
    if (stmt.type !== 'VariableDeclaration') continue
    for (const decl of stmt.declarations) {
      if (decl.id.type !== 'Identifier' || !decl.init) continue
      const iter = evaluator.evaluate(decl.init, tempScope)
      const step = iter.next()
      if (!step.done) throw new Error('Unexpected yield during deserialization')
      tempScope.set(decl.id, step.value)
    }
  }

  // Return a clean scope without the Value helper
  const vars = tempScope.globalThis.raw as { [key: string]: Value }
  delete vars.Value
  return new GlobalScope(Value.of(vars, [], { shallow: true }), false)
}
