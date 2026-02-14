import { describe, expect, it } from 'vitest'
import { GlobalScope, serializeScope } from './scope'
import { Value } from './utils'
import { safeEval } from './index'
import * as b from './ast'

describe('Value.toAST', () => {
  it('serializes string', () => {
    const v = Value.of('hello', [])
    expect(v.toAST()).toEqual(
      b.call(b.member(b.id('Value'), b.id('of')), [
        b.literal('hello'),
        b.array([]),
      ]),
    )
  })

  it('serializes number', () => {
    const v = Value.of(42, [])
    expect(v.toAST()).toEqual(
      b.call(b.member(b.id('Value'), b.id('of')), [
        b.literal(42),
        b.array([]),
      ]),
    )
  })

  it('serializes boolean', () => {
    const v = Value.of(true, [])
    expect(v.toAST()).toEqual(
      b.call(b.member(b.id('Value'), b.id('of')), [
        b.literal(true),
        b.array([]),
      ]),
    )
  })

  it('serializes null', () => {
    const v = Value.of(null, [])
    expect(v.toAST()).toEqual(
      b.call(b.member(b.id('Value'), b.id('of')), [
        b.literal(null),
        b.array([]),
      ]),
    )
  })

  it('serializes undefined', () => {
    const v = Value.of(undefined, [])
    expect(v.toAST()).toEqual(
      b.call(b.member(b.id('Value'), b.id('of')), [
        b.literal(undefined),
        b.array([]),
      ]),
    )
  })

  it('serializes bigint', () => {
    const v = Value.of(123n, [])
    expect(v.toAST()).toEqual(
      b.call(b.member(b.id('Value'), b.id('of')), [
        b.bigintLiteral(123n),
        b.array([]),
      ]),
    )
  })

  it('serializes array', () => {
    const v = Value.of([Value.of(1, []), Value.of(2, [])], [], { shallow: true })
    expect(v.toAST()).toEqual(
      b.call(b.member(b.id('Value'), b.id('of')), [
        b.array([
          b.call(b.member(b.id('Value'), b.id('of')), [b.literal(1), b.array([])]),
          b.call(b.member(b.id('Value'), b.id('of')), [b.literal(2), b.array([])]),
        ]),
        b.array([]),
      ]),
    )
  })

  it('serializes object', () => {
    const v = Value.of({ x: Value.of(1, []) }, [], { shallow: true })
    expect(v.toAST()).toEqual(
      b.call(b.member(b.id('Value'), b.id('of')), [
        b.object([
          b.prop('x', b.call(b.member(b.id('Value'), b.id('of')), [b.literal(1), b.array([])])),
        ]),
        b.array([]),
      ]),
    )
  })

  it('serializes taints', () => {
    const v = Value.of('secret', [['email', { principals: ['alice@example.com'] }]])
    expect(v.toAST()).toEqual(
      b.call(b.member(b.id('Value'), b.id('of')), [
        b.literal('secret'),
        b.array([
          b.array([
            b.literal('email'),
            b.object([
              b.prop('principals', b.literal(['alice@example.com'])),
            ]),
          ]),
        ]),
      ]),
    )
  })

  it('throws for class instances', () => {
    class MyClass { x = 1 }
    const v = Value.of(new MyClass(), [])
    expect(() => v.toAST()).toThrow('Cannot serialize class instance')
  })

  it('throws for external functions', () => {
    const v = Value.of(() => 42, [])
    expect(() => v.toAST()).toThrow('Cannot serialize external function')
  })
})

const makeScope = (vars: Record<string, Value>) =>
  new GlobalScope(Value.of(vars, [], { shallow: true }))

describe('serializeScope', () => {
  it('serializes empty scope', () => {
    const result = serializeScope(makeScope({}))
    expect(result.code).toBe('')
  })

  it('serializes primitives', () => {
    const scope = makeScope({
      str: Value.of('hello', []),
      num: Value.of(42, []),
      bool: Value.of(true, []),
      nil: Value.of(null, []),
    })
    const { code } = serializeScope(scope)
    expect(code).toBe(`const str = Value.of("hello", []);
const num = Value.of(42, []);
const bool = Value.of(true, []);
const nil = Value.of(null, []);
`)
  })

  it('serializes arrays', () => {
    const scope = makeScope({
      arr: Value.of([Value.of(1, []), Value.of(2, [])], [], { shallow: true }),
    })
    const { code } = serializeScope(scope)
    expect(code).toBe(`const arr = Value.of([Value.of(1, []), Value.of(2, [])], []);
`)
  })

  it('serializes objects', () => {
    const scope = makeScope({
      obj: Value.of({ x: Value.of(1, []), y: Value.of(2, []) }, [], { shallow: true }),
    })
    const { code } = serializeScope(scope)
    expect(code).toBe(`const obj = Value.of({
  x: Value.of(1, []),
  y: Value.of(2, [])
}, []);
`)
  })

  it('serializes taints', () => {
    const scope = makeScope({
      secret: Value.of('password', [['auth', { principals: ['alice@example.com'] }]]),
    })
    const { code } = serializeScope(scope)
    expect(code).toBe(`const secret = Value.of("password", [["auth", {
  principals: ["alice@example.com"]
}]]);
`)
  })

  it('serializes internal functions', async () => {
    const scope = Value.of({})
    const fn = await safeEval('x => x + 1', scope)
    const fnScope = makeScope({ myFn: fn })
    const { code } = serializeScope(fnScope)
    // fnNode/fnScope are preserved in the raw value, not serialized as options
    expect(code).toBe(`const myFn = Value.of(x => x + 1, []);
`)
  })
})
