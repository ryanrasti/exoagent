import type * as acorn from 'acorn'
import hash from 'object-hash'
import { getPolicyMetadata } from '../meta'

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
  isInternalFunction?: boolean
  parent?: Value<SafeEvalValueInner>
  propertyName?: string
  shallow?: boolean
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
    return Value.of(this.raw, normalizedExtra, {...this.options, shallow: false }).withTaints(this.taints, true) as Value<T>
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
    if (this.isFunction() && this.options?.isInternalFunction) {
      return (...args: unknown[]) => {
        const res = this.raw(...(args.map(arg => Value.of(arg))))
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
      return new Value(wrapped, taints, storedOptions)
    }
    if (typeof raw === 'object' && raw !== null) {
      const proto = Object.getPrototypeOf(raw)
      if (proto === null || proto === Object.prototype) {
        const wrapped: { [key: string]: Value<SafeEvalValueInner> } = {}
        for (const [key, val] of Object.entries(raw)) {
          wrapped[key] = val instanceof Value ? val.withTaints(subTaints) : Value.of(val as SafeEvalValueInner, subTaints, { shallow })
        }
        return new Value(wrapped, taints, storedOptions)
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
  getSlot(key: Value<string | number>): Value<SafeEvalValueInner> {
    if (!key.isSafeMember()) {
      throw new Error(`Key ${key.raw} is not a safe string or number`)
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

      const val = metadata[key.raw]
      if (!val) {
        throw new Error(`No policy metadata found for object: ${this.raw}.${key.raw}.`)
      }

      return Value.of(this.raw[key.raw], this.getTaints(), {
        propertyName: key.raw,
        parent: this,
      })
    }

    throw new Error(`Key ${key.raw} is not a safe string or number: ${typeof this.raw}`)
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
