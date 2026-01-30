import type * as acorn from 'acorn'
import type { RpcStub } from 'capnweb'
import { RpcPromise } from 'capnweb'

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

export type SafeEvalValueInternal
  = | string
    | boolean
    | number
    | null
    | bigint
    | undefined
    | ((...args: SafeEvalValueInternal[]) => SafeEvalValueInternal | Promise<SafeEvalValueInternal>)
    | SafeEvalHasMemberInternal

export type SafeEvalHasMemberInternal
  = | SafeEvalValueInternal[]
    | { [key: string]: SafeEvalValueInternal }
    | StubInternal

class _StubInternal {}
// We use an internal type for stubs because RpcStub<object> wreaks havoc with the type system
export type StubInternal = _StubInternal

export const isPlainObject = (obj: unknown): obj is Record<string, unknown> => {
  if (typeof obj !== 'object' || obj === null) {
    return false
  }
  const proto = Object.getPrototypeOf(obj)
  return proto === null || proto === Object.prototype
}

export const isStub = (obj: unknown): obj is StubInternal => {
  // const proto = Object.getPrototypeOf(obj)
  // console.log('proto', obj, proto, proto === RpcStub.prototype, proto === RpcPromise.prototype)
  // return proto === RpcStub.prototype || proto === RpcPromise.prototype
  // TODO: `typeof obj === 'function'` is a hack to allow stubs to be used as objects
  //    DO NOT SUBMIT THIS CHANGE
  return typeof obj === 'function'
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

export const isSafeMember = (member: string) => {
  // RpcPromise should have a prototype
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

export function assertSafeMember(member: unknown, node: acorn.Node): asserts member is string | number {
  const type = typeof member
  evalInvariant(type === 'string' || type === 'number', 'Member must be a string or number', node, member)
  evalInvariant(
    type === 'number' || isSafeMember(member as string),
    `Unsafe member access: ${member}`,
    node,
    member,
  )
};
