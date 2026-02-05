import { describe, expect, it } from 'vitest'
import { hasMembers, isPlainObject, isStub, unwrap, Value } from './utils.js'

describe('value', () => {
  it('stores raw and taints', () => {
    const v = Value.of(42, ['a'])
    expect(v.raw).toBe(42)
    expect(v.getTaints()).toEqual(['a'])
  })

  it('withTaints merges and returns new Value', () => {
    const v = Value.of(1, ['a'])
    const v2 = v.withTaints(['b'])
    expect(v.getTaints()).toEqual(['a'])
    expect(v2.raw).toBe(1)
    expect(v2.getTaints()).toEqual(['a', 'b'])
  })

  it('withTaints(empty) returns same', () => {
    const v = Value.of(1, ['a'])
    expect(v.withTaints([])).toBe(v)
  })

  it('value.mergeTaints deduplicates', () => {
    const a = Value.of(1, ['x', 'y'])
    const b = Value.of(2, ['y', 'z'])
    expect(Value.mergeTaints(a, b)).toEqual(['x', 'y', 'z'])
  })

  it('value.mergeTaints skips undefined', () => {
    const a = Value.of(1, ['a'])
    expect(Value.mergeTaints(a, undefined)).toEqual(['a'])
  })

  it('value.getTaints returns [] for non-Value', () => {
    expect(Value.getTaints(42)).toEqual([])
    expect(Value.getTaints(null)).toEqual([])
  })
})

describe('value type-check methods (no .raw at call site)', () => {
  it('string: hasMembers false, isStub false, isPlainObject false, isArray false, isString true', () => {
    const v = Value.of('hello', [])
    expect(v.hasMembers()).toBe(false)
    expect(v.isStub()).toBe(false)
    expect(v.isPlainObject()).toBe(false)
    expect(v.isArray()).toBe(false)
    expect(v.isString()).toBe(true)
  })

  it('number: isNumber true, others false', () => {
    const v = Value.of(42, [])
    expect(v.isNumber()).toBe(true)
    expect(v.isStub()).toBe(false)
    expect(v.isPlainObject()).toBe(false)
    expect(v.isArray()).toBe(false)
  })

  it('boolean, null, undefined, bigint: hasMembers false', () => {
    for (const raw of [true, null, undefined, 1n]) {
      const v = Value.of(raw, [])
      expect(v.hasMembers()).toBe(false)
      expect(v.isStub()).toBe(false)
    }
  })

  it('function (stub-like): isStub true', () => {
    const v = Value.of(() => 1, [])
    expect(v.isStub()).toBe(true)
    expect(v.isPlainObject()).toBe(false)
    expect(v.isArray()).toBe(false)
  })

  it('array: isArray true', () => {
    const v = Value.of([1, 2], [])
    expect(v.isArray()).toBe(true)
    expect(v.isStub()).toBe(false)
    expect(v.isPlainObject() || v.isStub()).toBe(false)
  })

  it('plain object: isPlainObject true, isPlainObject||isStub true', () => {
    const v = Value.of({ a: 1 }, []) as Value<unknown>
    expect(v.isPlainObject()).toBe(true)
    expect(v.isPlainObject() || v.isStub()).toBe(true)
    expect(v.isStub()).toBe(false)
    expect(v.isArray()).toBe(false)
  })

  it('object with prototype: isPlainObject false', () => {
    const v = Value.of(/x/, [])
    expect(v.isPlainObject()).toBe(false)
    expect(v.isStub()).toBe(false)
  })

  it('getSlot returns member Value with merged taints', () => {
    const v = Value.of({ a: 1, b: 2 }, ['obj'])
    const slotA = v.getSlot(Value.of('a', ['key']))
    expect(slotA.raw).toBe(1)
    expect(slotA.getTaints()).toEqual(['obj', 'key'])
    expect(v.getSlot(Value.of('b', [])).raw).toBe(2)
  })

  it('hasMembers: true for plain object, array, function; false for null, primitives', () => {
    expect(hasMembers({})).toBe(true)
    expect(hasMembers([])).toBe(true)
    expect(hasMembers(() => {})).toBe(true)
    expect(hasMembers(null)).toBe(false)
    expect(hasMembers(undefined)).toBe(false)
    expect(hasMembers(1)).toBe(false)
    expect(hasMembers('x')).toBe(false)
  })

  it('isPlainObject||isStub: true for plain object and function; false for array, null, primitives', () => {
    const check = (obj: unknown) => Value.of(obj, []).isPlainObject() || Value.of(obj, []).isStub()
    expect(check({})).toBe(true)
    expect(check(() => {})).toBe(true)
    expect(check([])).toBe(false)
    expect(check(null)).toBe(false)
    expect(check(1)).toBe(false)
  })
})

describe('unwrap', () => {
  it('primitives pass through', () => {
    expect(unwrap(Value.of(1, []))).toBe(1)
    expect(unwrap(Value.of('x', []))).toBe('x')
    expect(unwrap(Value.of(null, []))).toBe(null)
    expect(unwrap(undefined)).toBe(undefined)
  })

  it('array of Values unwraps recursively', () => {
    const v = Value.of([Value.of(1, []), Value.of(2, [])], [])
    expect(unwrap(v)).toEqual([1, 2])
  })

  it('object of Values unwraps recursively', () => {
    const v = Value.of({ a: Value.of(1, []), b: Value.of(2, []) }, [])
    expect(unwrap(v)).toEqual({ a: 1, b: 2 })
  })
})
