import type * as acorn from 'acorn'
import type { RpcTarget } from 'capnweb'
import { RpcPromise } from 'capnweb'
import { getPolicyMetadata } from '../meta'

const checkSafeMember = (member: string) => {
  if (!('prototype' in RpcPromise) || typeof RpcPromise.prototype !== 'object' || RpcPromise.prototype === null) {
    throw new Error('RpcPromise has no prototype')
  }
  const unsafe
    = member in Object.prototype
      || (member in RpcPromise.prototype)
      || member === 'constructor'
      || member === 'prototype'
      || member === '__proto__'
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
}

// Single wrapper for values in eval: raw value + taints + helpers. Wrap/unwrap only at boundaries.
export class Value<T extends SafeEvalValueInner = SafeEvalValueInner, Taint extends string = string> {
  constructor(
    public readonly raw: T,
    public readonly taints: readonly Taint[] = [],
    public readonly options: ValueOptions = {},
  ) {
    // TODO: implicit in all of this is that objects and arrays must be
    //  wrapped in Value objects; this is not enforced (yet).
  }

  getTaints(): Taint[] {
    return [...this.taints]
  }

  withTaints(extra: readonly string[]): Value<T> {
    return extra.length === 0 ? this : new Value(this.raw, [...this.taints, ...extra]) as Value<T>
  }

  /** Recursively unwrap arrays and objects, converting Value instances back to raw values. */
  unwrap(): SafeEvalValueInner {
    // Arrays: unwrap each element recursively
    if (Array.isArray(this.raw)) {
      return this.raw.map(item => item instanceof Value ? item.unwrap() : item) as SafeEvalValue
    }
    // Plain objects: unwrap each property value recursively
    if (this.isPlainObject()) {
      const unwrapped: { [key: string]: SafeEvalValueInner } = {}
      for (const [key, val] of Object.entries(this.raw)) {
        unwrapped[key] = val instanceof Value ? val.unwrap() : val as SafeEvalValueInner
      }
      return unwrapped as SafeEvalValueInner
    }
    // Primitives, functions, stubs, etc.: return raw value
    return this.raw as SafeEvalValueInner
  }

  static of(raw: unknown, taints?: readonly string[], options?: ValueOptions): Value
  static of<T extends SafeEvalValueInner>(raw: T, taints?: readonly string[], options?: ValueOptions): Value<T>
  static of(raw: unknown, taints: readonly string[] = [], options?: ValueOptions): Value {
    // Recursively wrap arrays and objects
    if (Array.isArray(raw)) {
      const wrapped = raw.map(item => item instanceof Value ? item : Value.of(item as SafeEvalValueInner, []))
      return new Value(wrapped as T, taints, options)
    }
    if (typeof raw === 'object' && raw !== null) {
      const proto = Object.getPrototypeOf(raw)
      if (proto === null || proto === Object.prototype) {
        const wrapped: { [key: string]: Value<SafeEvalValueInner> } = {}
        for (const [key, val] of Object.entries(raw)) {
          wrapped[key] = val instanceof Value ? val : Value.of(val as SafeEvalValueInner, [])
        }
        return new Value(wrapped as T, taints, options)
      }
    }
    if (raw instanceof Value) {
      return raw.withTaints(taints)
    }
    return new Value(raw, taints, options)
  }

  static mergeTaints(...items: (Value<SafeEvalValueInner> | undefined)[]): string[] {
    return [...new Set(items.flatMap(x => (x != null ? x.getTaints() : [])))]
  }

  static getTaints(x: unknown): string[] {
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
    return typeof this.raw === 'object' && this.raw !== null && !this.isPlainObject()
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
      return this.raw[key.raw].withTaints(key.getTaints())
    }
    if (this.isArray()) {
      if (!key.isNumber()) {
        throw new Error(`Index must be a number`)
      }
      return this.raw[key.raw].withTaints(key.getTaints())
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
      console.log('asAwaitable', this.raw)
      return this.raw.then(v => Value.of(v, this.getTaints()))
    }
    console.log('asAwaitable', this.raw, 'not thenable')
    return this
  }

  callStub(this: Value<(...args: unknown[]) => unknown>, thisVal: Value, args: Value[]): Value {
    return Value.of(Reflect.apply(this.raw, thisVal.raw, args.map(a => a.unwrap())), Value.mergeTaints(thisVal, ...args))
  }

  toString(): string {
    return `Value(raw: ${JSON.stringify(this.raw)}, taints: ${this.getTaints().join(', ')})`
  }
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
    | RpcTarget

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
