import type * as acorn from 'acorn'
import hash from 'object-hash'
import { getPolicyMetadata } from '../meta'
import * as b from './ast'

// Hierarchical taint: [type, params]
// params can carry context like principals (email addresses who have access)
export type TaintParams = {
  principals?: string[]
}

export type Taint = [string, TaintParams]

// Input types for convenience - strings are normalized to tuples
export type TaintInput = string | Taint
// TaintsInput can be:
// - A single string: 'email' -> [['email', {}]]
// - A single tuple: ['email', {principals: [...]}] -> [['email', {principals: [...]}]]
// - An array of strings/tuples: ['email', ['calendar', {}]] -> [['email', {}], ['calendar', {}]]
export type TaintsInput = TaintInput | readonly TaintInput[]

/** Check if value is a single Taint tuple (not an array of taints) */
function isSingleTaint(t: TaintsInput): t is Taint {
  return Array.isArray(t)
    && t.length === 2
    && typeof t[0] === 'string'
    && typeof t[1] === 'object'
    && t[1] !== null
    && !Array.isArray(t[1])
}

function deduplicateTaints(taints: Taint[]): Taint[] {
  return [...new Map(taints.map(t => [hash(t), t])).values()]
}

/** Normalize a single taint input to tuple form */
export function normalizeTaint(t: TaintInput): Taint {
  return typeof t === 'string' ? [t, {}] : t
}

/** Normalize taint inputs to tuple array */
export function normalizeTaints(taints: TaintsInput): Taint[] {
  // Single string: 'email' -> [['email', {}]]
  if (typeof taints === 'string') {
    return [[taints, {}]]
  }
  // Single tuple: ['email', {principals}] -> [['email', {principals}]]
  if (isSingleTaint(taints)) {
    return [taints]
  }
  // Array of inputs
  const normalized = (taints as readonly TaintInput[]).map(normalizeTaint)
  return deduplicateTaints(normalized)
}

const checkSafeMember = (member: string) => {
  const unsafe
    = member in Object.prototype
      || member === 'constructor'
      || member === 'prototype'
      || member === '__proto__'
      || member === 'toJSON'
      || member === 'toString'
      // Promise-related members - prevents constructing thenables that could
      // bypass policy checks when used with `await`
      || member === 'then'
      || member === 'catch'
      || member === 'finally'
  return !unsafe
}

export function isSafeMemberRaw(member: unknown): member is string | number {
  const t = typeof member
  if (t !== 'string' && t !== 'number')
    return false
  return t === 'number' || checkSafeMember(member as string)
}

export type ValueOptions = {
  /** AST node for internal functions (presence implies isInternalFunction) */
  fnNode?: acorn.ArrowFunctionExpression
  /** True for builtin Value methods (ArrayValue.map, etc.) - called like internal fns */
  builtinFunction?: boolean
  parent?: Value<SafeEvalValueInner>
  propertyName?: string
  shallow?: boolean
  /** True for whitelisted constructors (e.g., Date) that can be used with `new` */
  constructorAllowed?: boolean
}

/**
 * Policy checker called during unwrap to validate taints at the boundary.
 * @param taints - The taints on the value being unwrapped (hierarchical tuples)
 * @param path - The path to this value (e.g., "result.foo[0]")
 */
export type PolicyChecker = (taints: readonly Taint[], path: string) => void

// Single wrapper for values in eval: raw value + taints + helpers. Wrap/unwrap only at boundaries.
export class Value<T extends SafeEvalValueInner = SafeEvalValueInner> {
  public readonly taints: readonly Taint[]

  constructor(
    public readonly raw: T,
    taints: TaintsInput = [],
    public readonly options: ValueOptions = {},
  ) {
    // Normalize string taints to tuple form
    this.taints = normalizeTaints(taints)
    // TODO: implicit in all of this is that objects and arrays must be
    //  wrapped in Value objects; this is not enforced (yet).
  }

  getTaints(): Taint[] {
    return [...this.taints]
  }

  /** Add taints deeply to this value and all nested children. */
  withTaints(extra: TaintsInput, shallow: boolean = false): Value<T> {
    if (extra.length === 0) {
      return this
    }
    const normalizedExtra = normalizeTaints(extra)
    if (shallow) {
      return new Value(this.raw, [...this.taints, ...normalizedExtra], this.options)
    }
    // Use `Value.of` to recursively taint the value with the new taints.
    // Then any existing taints should just be shallowly added:
    return Value.of(this.raw, normalizedExtra, { ...this.options, shallow: false }).withTaints(this.taints, true) as Value<T>
  }

  withOptions(opts: Partial<ValueOptions>): Value<T> {
    return new Value(this.raw, this.taints, { ...this.options, ...opts })
  }

  /**
   * Recursively unwrap arrays and objects, converting Value instances back to raw values.
   * Policy check is enforced at this boundary for all values including deferred ones.
   * @param checkPolicy - Mandatory policy checker to validate taints
   * @param path - Current path for error messages (default: 'result')
   */
  unwrap(checkPolicy: PolicyChecker, path: string = 'result'): SafeEvalValueInner {
    // Check policy on this value's taints
    checkPolicy(this.taints, path)

    // Arrays: unwrap each element recursively
    if (Array.isArray(this.raw)) {
      return this.raw.map((item, i) =>
        item instanceof Value ? item.unwrap(checkPolicy, `${path}[${i}]`) : item,
      ) as SafeEvalValueInner
    }

    // Plain objects: unwrap each property value recursively
    if (this.isPlainObject()) {
      const unwrapped: { [key: string]: SafeEvalValueInner } = {}
      for (const [key, val] of Object.entries(this.raw)) {
        unwrapped[key] = val instanceof Value ? val.unwrap(checkPolicy, `${path}.${key}`) : val as SafeEvalValueInner
      }
      return unwrapped as SafeEvalValueInner
    }

    // Internal functions: wrap to check policy on result when called
    if (this.isFunction() && this.options?.fnNode) {
      return (...args: unknown[]) => {
        const res = this.raw(...(args.map(arg => Value.of(arg))))
        // Handle async functions - if result is a Promise, unwrap after resolution
        if (res instanceof Promise) {
          return res.then((resolved: unknown) => {
            const val = resolved instanceof Value ? resolved : Value.of(resolved, [])
            return val.unwrap(checkPolicy, `${path}()`)
          })
        }
        // Policy check happens when function result is unwrapped
        return res.unwrap(checkPolicy, `${path}()`)
      }
    }

    // Promises/thenables: wrap to check policy on resolution
    if (this.isThenable()) {
      return (this.raw as PromiseLike<Value>).then((resolved) => {
        const val = resolved instanceof Value ? resolved : Value.of(resolved, this.taints)
        return val.unwrap(checkPolicy, path)
      }) as SafeEvalValueInner
    }

    // Primitives, external functions, stubs: return raw value
    return this.raw as SafeEvalValueInner
  }

  // Factory for creating array values - can be overridden by builtins.ts
  static arrayFactory: ((raw: Value[], taints: TaintsInput, options: ValueOptions) => Value) | null = null
  // Factory for creating string values - can be overridden by builtins.ts
  static stringFactory: ((raw: string, taints: TaintsInput, options: ValueOptions) => Value) | null = null

  static of(raw: unknown, taints?: TaintsInput, options?: ValueOptions): Value
  static of<T extends SafeEvalValueInner>(raw: T, taints?: TaintsInput, options?: ValueOptions): Value<T>
  static of(raw: unknown, taints: TaintsInput = [], options?: ValueOptions): Value {
    const shallow = options?.shallow ?? false
    const subTaints = shallow ? [] : taints
    // Strip shallow from stored options - it's only used for control flow
    const { shallow: _, ...storedOptions } = options ?? {}
    // Recursively wrap arrays and objects
    if (Array.isArray(raw)) {
      const wrapped = raw.map(item => item instanceof Value ? item.withTaints(subTaints) : Value.of(item as SafeEvalValueInner, subTaints, { shallow }))
      // Merge children's taints into parent (important when children are already Values)
      const childTaints = Value.mergeTaints(...wrapped)
      const allTaints = [...normalizeTaints(taints), ...childTaints]
      // Use arrayFactory if available (for ArrayValue support)
      if (Value.arrayFactory) {
        return Value.arrayFactory(wrapped, allTaints, storedOptions)
      }
      return new Value(wrapped, allTaints, storedOptions)
    }
    // Use stringFactory if available (for StringValue support)
    if (typeof raw === 'string' && Value.stringFactory) {
      return Value.stringFactory(raw, taints, storedOptions)
    }
    if (typeof raw === 'object' && raw !== null) {
      const proto = Object.getPrototypeOf(raw)
      if (proto === null || proto === Object.prototype) {
        const wrapped: { [key: string]: Value<SafeEvalValueInner> } = {}
        for (const [key, val] of Object.entries(raw)) {
          wrapped[key] = val instanceof Value ? val.withTaints(subTaints) : Value.of(val as SafeEvalValueInner, subTaints, { shallow })
        }
        // Merge children's taints into parent
        const childTaints = Value.mergeTaints(...Object.values(wrapped))
        const allTaints = [...normalizeTaints(taints), ...childTaints]
        return new Value(wrapped, allTaints, storedOptions)
      }
    }
    if (raw instanceof Value) {
      return raw.withTaints(taints)
    }
    return new Value(raw, taints, storedOptions)
  }

  static mergeTaints(...items: (Value<SafeEvalValueInner> | undefined)[]): Taint[] {
    const all = items.flatMap(x => (x != null ? x.getTaints() : []))
    // Deduplicate by structural equality using hash
    return deduplicateTaints(all)
  }

  static getTaints(x: unknown): Taint[] {
    return x instanceof Value ? x.getTaints() : []
  }

  isFunction(): this is Value<(...args: unknown[]) => unknown> {
    return typeof this.raw === 'function'
  }

  isPlainObject(): this is Value<{ [key: string]: Value<SafeEvalValueInner> }> {
    if (typeof this.raw !== 'object' || this.raw === null)
      return false
    const proto = Object.getPrototypeOf(this.raw)
    return proto === null || proto === Object.prototype
  }

  isClassLike(): this is Value<{ [key: string]: Value<SafeEvalValueInner> }> {
    return typeof this.raw === 'object' && this.raw !== null && !this.isPlainObject() && !this.isArray()
  }

  isArray(): this is Value<Value<SafeEvalValueInner>[]> {
    return Array.isArray(this.raw)
  }

  isThenable(): this is Value<PromiseLike<SafeEvalValueInner>> {
    if (!this.isPlainObject() && !(typeof this.raw === 'object' && this.raw !== null)) {
      return false
    }
    return typeof (this.raw as PromiseLike<unknown>)?.then === 'function'
  }

  isNumber(): this is Value<number> {
    return typeof this.raw === 'number'
  }

  isString(): this is Value<string> {
    return typeof this.raw === 'string'
  }

  /** Slot for key; returns Value with taints merged from this and key. */
  getSlotRaw(key: Value<string | number>): Value<SafeEvalValueInner> | undefined {
    // Date objects - whitelist safe methods
    // TODO: Date support needs more scrutiny:
    //   1. Need a better model for handling builtin libraries (Date, Math, JSON, etc.)
    //      - Currently using ad-hoc whitelist, should be more systematic
    //      - Consider using @tool decorator pattern for builtins too
    //   2. Date methods that take arguments (e.g., toLocaleString options) need input validation/parsing
    //   3. The Date constructor in code-mode.ts also needs input validation
    if (this.raw instanceof Date && typeof key.raw === 'string') {
      const safeDateMethods = new Set([
        'toISOString',
        'toJSON',
        'toString',
        'toDateString',
        'toTimeString',
        'toLocaleDateString',
        'toLocaleTimeString',
        'toLocaleString',
        'getTime',
        'getFullYear',
        'getMonth',
        'getDate',
        'getDay',
        'getHours',
        'getMinutes',
        'getSeconds',
        'getMilliseconds',
        'getUTCFullYear',
        'getUTCMonth',
        'getUTCDate',
        'getUTCDay',
        'getUTCHours',
        'getUTCMinutes',
        'getUTCSeconds',
        'getUTCMilliseconds',
        'getTimezoneOffset',
        'valueOf',
      ])
      if (safeDateMethods.has(key.raw)) {
        const method = (this.raw as any)[key.raw].bind(this.raw)
        return Value.of(method, this.getTaints(), {
          propertyName: key.raw,
          parent: this,
          builtinFunction: true,
        })
      }
      throw new Error(`Date method '${key.raw}' is not whitelisted`)
    }

    if (!key.isSafeMember()) {
      throw new Error(`Key ${key.raw} is not a safe string or number`)
    }

    // First check if the Value subclass itself has methods with metadata (e.g., ArrayValue.map)
    if (typeof key.raw === 'string') {
      const selfMetadata = getPolicyMetadata(this)
      if (selfMetadata && selfMetadata[key.raw]) {
        // Return a bound method as a Value
        const method = (this as any)[key.raw]
        if (typeof method === 'function') {
          const boundMethod = method.bind(this)
          return Value.of(boundMethod, this.getTaints(), {
            propertyName: key.raw,
            parent: this,
            builtinFunction: true, // Treat like internal fn - no unwrap in doStubCall
          })
        }
      }
    }

    if (this.isPlainObject()) {
      return (this.raw[key.raw] ?? Value.Undefined).withTaints(key.getTaints())
    }

    if (this.isArray()) {
      // Allow accessing 'length' on arrays
      if (key.raw === 'length') {
        return Value.of(this.raw.length, this.getTaints()).withTaints(key.getTaints())
      }
      if (!key.isNumber()) {
        throw new Error(`Index must be a number`)
      }
      return (this.raw[key.raw] ?? Value.Undefined).withTaints(key.getTaints())
    }

    if (typeof this.raw === 'object' && this.raw !== null) {
      if (typeof key.raw !== 'string') {
        throw new TypeError(`Key must be a string`)
      }
      const metadata = getPolicyMetadata(this.raw)
      if (!metadata) {
        throw new Error(`No policy metadata found for object: ${this.raw}. Cannot access its members.`)
      }

      const methodMeta = metadata[key.raw] as { builtin?: boolean } | undefined
      if (!methodMeta) {
        throw new Error(`No policy metadata found for object: ${this.raw}.${key.raw}.`)
      }

      // Check if this is a @builtin method (marked with { builtin: true })
      const isBuiltin = methodMeta.builtin === true

      return Value.of(this.raw[key.raw], this.getTaints(), {
        propertyName: key.raw,
        parent: this,
        builtinFunction: isBuiltin, // Treat like internal fn - no unwrap in doStubCall
      })
    }

    return undefined
  }

  getSlot(key: Value<string | number>, node: acorn.Node): Value<SafeEvalValueInner> {
    const slot = this.getSlotRaw(key)
    evalInvariant(slot !== undefined, `Key ${key.raw} is not a safe string or number: ${this.raw}`, node, key.raw)
    return slot
  }

  /** True if this value is a safe member key (string | number, and string not unsafe). */
  isSafeMember(): this is Value<string | number> {
    return isSafeMemberRaw(this.raw as unknown)
  }

  static isThenable(x: unknown): boolean {
    return typeof x === 'object' && x !== null
      && typeof (x as Promise<unknown>)?.then === 'function'
  }

  asAwaitable(): PromiseLike<Value<SafeEvalValueInner>> | Value<SafeEvalValueInner> {
    if (this.isThenable()) {
      return (async () => {
        const v = await this.raw
        // If the Promise resolved to a Value, merge taints and return it
        if (v instanceof Value) {
          return v.withTaints([...this.getTaints(), ...v.getTaints()])
        }
        return Value.of(v, this.getTaints()).asAwaitable()
      })()
    }
    return this
  }

  toString(): string {
    const taintStrs = this.taints.map(([type, params]) => {
      const paramStr = Object.keys(params).length > 0 ? JSON.stringify(params) : ''
      return paramStr ? `${type}${paramStr}` : type
    })
    return `Value(raw: ${JSON.stringify(this.raw)}, taints: ${taintStrs.join(', ')})`
  }

  /**
   * Serialize this Value to an AST node (CallExpression for Value.of(...))
   * Throws if the value cannot be serialized (class instances, external functions)
   */
  toAST(): acorn.CallExpression {
    return b.call(
      b.member(b.id('Value'), b.id('of')),
      [this.rawToAST(), this.taintsToAST(), ...this.optionsToAST()],
    )
  }

  private rawToAST(): acorn.Expression {
    const raw = this.raw

    // Primitives
    if (raw === null || raw === undefined || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      return b.literal(raw)
    }

    if (typeof raw === 'bigint') {
      return b.bigintLiteral(raw)
    }

    // Arrays (contain Value instances)
    if (Array.isArray(raw)) {
      return b.array(raw.map((item) => {
        if (!(item instanceof Value)) {
          throw new TypeError(`Array element is not a Value: ${item}`)
        }
        return item.toAST()
      }))
    }

    // Internal functions - use the stored AST node
    if (typeof raw === 'function') {
      if (!this.options.fnNode) {
        throw new Error('Cannot serialize external function (no fnNode)')
      }
      return this.options.fnNode
    }

    // Date objects - serialize as new Date("iso-string")
    if (raw instanceof Date) {
      return b.newExpr(b.id('Date'), [b.literal(raw.toISOString())])
    }

    // Plain objects (contain Value instances)
    if (typeof raw === 'object') {
      const proto = Object.getPrototypeOf(raw)
      if (proto !== null && proto !== Object.prototype) {
        throw new Error('Cannot serialize class instance')
      }
      return b.object(Object.entries(raw).map(([key, val]) => {
        if (!(val instanceof Value)) {
          throw new TypeError(`Object property "${key}" is not a Value: ${val}`)
        }
        return b.prop(key, val.toAST())
      }))
    }

    throw new Error(`Cannot serialize value of type ${typeof raw}`)
  }

  private taintsToAST(): acorn.ArrayExpression {
    return b.array(this.taints.map(taint =>
      b.array([
        b.literal(taint[0]),
        b.object(Object.entries(taint[1]).map(([k, v]) =>
          b.prop(k, b.literal(v as string | number | boolean | null)),
        )),
      ]),
    ))
  }

  private optionsToAST(): acorn.ObjectExpression[] {
    // fnNode is not serialized as an option - it's preserved in the raw
    // function value when the evaluator processes the arrow expression
    return []
  }

  static Undefined = Value.of(undefined, [])
}

// Inner = unwrapped shape; inside eval we use Value<SafeEvalValueInner>.
export type SafeEvalValueInner
  = | string
    | boolean
    | number
    | null
    | bigint
    | undefined
    | ((...args: Value<SafeEvalValueInner>[]) => Value<SafeEvalValueInner> | Promise<Value<SafeEvalValueInner>>)
    | SafeEvalHasMemberInner

export type SafeEvalHasMemberInner
  = | Value<SafeEvalValueInner>[]
    | { [key: string]: Value<SafeEvalValueInner> }

/**
 * Formats an error message with a code snippet showing the relevant location.
 */
export function formatCodeMessage(
  code: string,
  position: number,
  message: string,
): string {
  // Find the line containing the position
  const lines = code.split('\n')
  let currentPos = 0
  let lineNumber = 0
  let columnNumber = 0

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length + 1 // +1 for newline
    if (currentPos + lineLength > position) {
      lineNumber = i
      columnNumber = position - currentPos
      break
    }
    currentPos += lineLength
  }

  const line = lines[lineNumber] ?? ''
  const pointer = `${' '.repeat(columnNumber)}^`

  return `${message}\n  ${lineNumber + 1} | ${line}\n    | ${pointer}`
}

export class Invariant {
  constructor(private readonly code: string) {}

  parse(
    condition: boolean,
    message: string,
    node: acorn.Node,
  ): asserts condition {
    if (!condition) {
      throw new Error(formatCodeMessage(this.code, node.start, `Parse error: ${message}`))
    }
  }

  eval(
    condition: boolean,
    message: string,
    node: acorn.Node,
    value: unknown,
  ): asserts condition {
    if (!condition) {
      const valueStr = JSON.stringify(value)
      throw new Error(formatCodeMessage(this.code, node.start, `Eval error: ${message} (value: ${valueStr})`))
    }
  }
}

export function parseInvariant(
  condition: boolean,
  message: string,
  node: acorn.Node,
): asserts condition {
  if (!condition) {
    throw new Error(`Invariant failed: ${message} at ${node.start}`)
  }
}

export function evalInvariant(
  condition: boolean,
  message: string,
  node: acorn.Node,
  value: unknown,
): asserts condition {
  if (!condition) {
    throw new Error(
      `Invariant failed: ${message} at ${
        node.start
      } with value ${JSON.stringify(value)}`,
    )
  }
}

export function assertSafeMember(member: unknown, node: acorn.Node): asserts member is string | number {
  evalInvariant(isSafeMemberRaw(member), 'Member must be a safe string or number', node, member)
}

export const controlAwaitSymbol = Symbol('controlAwait')
export type AwaitControl = { [controlAwaitSymbol]: 'await', value: Value<SafeEvalValueInner> | Promise<Value<SafeEvalValueInner>>, node: acorn.Expression }
export const emitAwaitControl = (value: Value<SafeEvalValueInner>, node: acorn.Expression): AwaitControl =>
  ({ [controlAwaitSymbol]: 'await', value, node })
