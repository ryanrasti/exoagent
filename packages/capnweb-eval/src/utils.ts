import type * as acorn from 'acorn'
import { RpcPromise, RpcStub, RpcTarget } from 'capnweb'

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

// Single wrapper for values in eval: raw value + taints + helpers. Wrap/unwrap only at boundaries.
export class Value<T extends SafeEvalValueInner = SafeEvalValueInner, Taint extends string = string> {
  constructor(
    public readonly raw: T,
    public readonly taints: readonly Taint[] = [],
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
  unwrap(): SafeEvalValue {
    // Arrays: unwrap each element recursively
    if (Array.isArray(this.raw)) {
      return this.raw.map(item => item instanceof Value ? item.unwrap() : item) as SafeEvalValue
    }
    // Plain objects: unwrap each property value recursively
    if (this.isPlainObject()) {
      const unwrapped: { [key: string]: SafeEvalValue } = {}
      for (const [key, val] of Object.entries(this.raw)) {
        unwrapped[key] = val instanceof Value ? val.unwrap() : val as SafeEvalValue
      }
      return unwrapped as SafeEvalValue
    }
    // Primitives, functions, stubs, etc.: return raw value
    return this.raw as SafeEvalValue
  }

  static of<T extends SafeEvalValueInner>(raw: T, taints: readonly string[] = []): Value<T> {
    // Recursively wrap arrays and objects
    if (Array.isArray(raw)) {
      const wrapped = raw.map(item => item instanceof Value ? item : Value.of(item as SafeEvalValueInner, []))
      return new Value(wrapped as T, taints)
    }
    if (typeof raw === 'object' && raw !== null) {
      const proto = Object.getPrototypeOf(raw)
      if (proto === null || proto === Object.prototype) {
        const wrapped: { [key: string]: Value<SafeEvalValueInner> } = {}
        for (const [key, val] of Object.entries(raw)) {
          wrapped[key] = val instanceof Value ? val : Value.of(val as SafeEvalValueInner, [])
        }
        return new Value(wrapped as T, taints)
      }
    }
    return new Value(raw, taints)
  }

  static mergeTaints(...items: (Value<SafeEvalValueInner> | undefined)[]): string[] {
    return [...new Set(items.flatMap(x => (x != null ? x.getTaints() : [])))]
  }

  static getTaints(x: unknown): string[] {
    return x instanceof Value ? x.getTaints() : []
  }

  hasMembers(): this is Value<{ [key: string]: unknown } | ((...args: unknown[]) => unknown)> {
    // TODO: `typeof object === 'function'` is a hack to allow stubs to be used as objects
    //    DO NOT SUBMIT THIS CHANGE
    return (typeof this.raw === 'object' || typeof this.raw === 'function') && this.raw !== null
  }

  isStub(): this is RpcTarget {
    console.log('isStub', this.raw)
    return this.raw instanceof RpcTarget
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

  isArray(): this is Value<Value<SafeEvalValueInner>[]> {
    return Array.isArray(this.raw)
  }

  isThenable(): this is Value<PromiseLike<SafeEvalValueInner>> {
    if (!this.isPlainObject() && !this.isStub()) {
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
    const obj = this.raw as { [key: string]: Value<SafeEvalValueInner> }
    return key.raw in obj ? obj[key.raw].withTaints(key.getTaints()) : Value.of(undefined, [])
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
    return Value.of(Reflect.apply(this.raw, thisVal.raw, args.map(a => a.raw)), Value.mergeTaints(thisVal, ...args))
  }
}

export type SafeEvalValue
  = | string
    | boolean
    | number
    | null
    | bigint
    | undefined
    | ((...args: SafeEvalValue[]) => SafeEvalValue)
    | SafeEvalValue[]
    | { [key: string]: SafeEvalValue }
    | RpcStub<object>
    | RpcPromise<object>

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
    | StubInternal

class _StubInternal {}
// We use an internal type for stubs because RpcStub<object> wreaks havoc with the type system
export type StubInternal = _StubInternal

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
