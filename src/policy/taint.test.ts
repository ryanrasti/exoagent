import { RpcStub, RpcTarget } from 'capnweb'
import { describe, expect, it } from 'vitest'
import { getTaints, getValue, wrapTainted } from './taint.js'

describe('taint', () => {
  it('wraps a primitive and taints infect', () => {
    const w = wrapTainted(42, ['x'])
    expect(getTaints(w)).toEqual(new Set(['x']))
    // Taints infect: passing to a function unions taints on return
    const add = (a: number, b: number) => a + b
    const wrappedAdd = wrapTainted(add, ['base'])
    const two = wrapTainted(2, ['y'])
    const result = wrappedAdd(1, two) as number
    expect(getValue(result)).toBe(3)
    expect(getTaints(result)).toEqual(new Set(['base', 'y']))
  })

  it('wraps an object and property access preserves taints', () => {
    const obj = { a: 1, b: { c: 2 } }
    const w = wrapTainted(obj, ['x'])
    expect(getTaints(w)).toEqual(new Set(['x']))
    expect(getValue((w as typeof obj).a)).toBe(1)
    expect(getTaints((w as typeof obj).a)).toEqual(new Set(['x']))
    expect(getValue((w as typeof obj).b.c)).toBe(2)
    expect(getTaints((w as typeof obj).b)).toEqual(new Set(['x']))
  })

  it('wraps an array and index access preserves taints', () => {
    const arr = [10, 20, 30]
    const w = wrapTainted(arr, ['x'])
    expect(getTaints(w)).toEqual(new Set(['x']))
    expect(getValue((w as number[])[0])).toBe(10)
    expect(getTaints((w as number[])[0])).toEqual(new Set(['x']))
  })

  it('on function call, taints union from args', () => {
    const id = (x: number) => x
    const wrappedId = wrapTainted(id, ['f'])
    const arg = wrapTainted(7, ['arg'])
    const result = wrappedId(arg) as number
    expect(getValue(result)).toBe(7)
    expect(getTaints(result)).toEqual(new Set(['f', 'arg']))
  })

  it('remote call (RpcStub) wraps args in TaintedValue', async () => {
    let received: unknown
    const target = new (class extends RpcTarget {
      capture(arg: unknown) {
        received = arg
      }
    })()
    const stub = new RpcStub(target)
    const wrappedStub = wrapTainted(stub, ['caller'])
    await (wrappedStub as typeof stub).capture(42)
    expect(getTaints(received)).toEqual(new Set(['caller']))
    expect(getValue(received)).toBe(42)
  })

  it('wraps RpcStub and taints infect through method return', async () => {
    const target = new (class extends RpcTarget {
      double(n: number) {
        return n * 2
      }
    })()
    const stub = new RpcStub(target)
    const wrappedStub = wrapTainted(stub, ['caller'])
    const result = await (wrappedStub as typeof stub).double(5)
    expect(getValue(result)).toBe(10)
    expect(getTaints(result)).toEqual(new Set(['caller']))
  })

  it('wraps a regular promise and .then result is tainted', async () => {
    const p = Promise.resolve(99)
    const w = wrapTainted(p, ['p'])
    const result = await (w as Promise<number>)
    expect(getValue(result)).toBe(99)
    expect(getTaints(result)).toEqual(new Set(['p']))
  })
})
