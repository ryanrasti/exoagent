import { describe, expect, it } from 'vitest'
import { Value } from './utils.js'

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
    expect(v.isPlainObject()).toBe(false)
    expect(v.isArray()).toBe(false)
    expect(v.isString()).toBe(true)
  })

  it('number: isNumber true, others false', () => {
    const v = Value.of(42, [])
    expect(v.isNumber()).toBe(true)
    expect(v.isPlainObject()).toBe(false)
    expect(v.isArray()).toBe(false)
  })

  it('function (stub-like): isStub true', () => {
    const v = Value.of(() => 1, [])
    expect(v.isPlainObject()).toBe(false)
    expect(v.isArray()).toBe(false)
  })

  it('array: isArray true', () => {
    const v = Value.of([1, 2], [])
    expect(v.isArray()).toBe(true)
    expect(v.isPlainObject() || v.isClassLike()).toBe(false)
  })

  it('plain object: isPlainObject true, isPlainObject||isStub true', () => {
    const v = Value.of({ a: 1 }, []) as Value<unknown>
    expect(v.isPlainObject()).toBe(true)
    expect(v.isPlainObject() || v.isClassLike()).toBe(true)
    expect(v.isClassLike()).toBe(false)
    expect(v.isArray()).toBe(false)
  })

  it('object with prototype: isPlainObject false', () => {
    const v = Value.of(/x/, [])
    expect(v.isPlainObject()).toBe(false)
    expect(v.isClassLike()).toBe(true)
  })

  it('getSlot returns member Value with merged taints', () => {
    const v = Value.of({ a: 1, b: 2 }, ['obj'])
    const slotA = v.getSlot(Value.of('a', ['key']))
    expect(slotA.raw).toBe(1)
    expect(slotA.getTaints()).toEqual(['obj', 'key'])
    expect(v.getSlot(Value.of('b', [])).raw).toBe(2)
  })

  it('isPlainObject||isStub: true for plain object and function; false for array, null, primitives', () => {
    const check = (obj: unknown) => Value.of(obj, []).isPlainObject() || Value.of(obj, []).isClassLike()
    expect(check({})).toBe(true)
    expect(check(() => {})).toBe(false)
    expect(check([])).toBe(false)
    expect(check(null)).toBe(false)
    expect(check(1)).toBe(false)
  })
})

describe('unwrap', () => {
  it('primitives pass through', () => {
    expect(Value.of(1, []).unwrap()).toBe(1)
    expect(Value.of('x', []).unwrap()).toBe('x')
    expect(Value.of(null, []).unwrap()).toBe(null)
    expect(Value.of(undefined, []).unwrap()).toBe(undefined)
  })

  it('array of Values unwraps recursively', () => {
    const v = Value.of([Value.of(1, []), Value.of(2, [])], [])
    expect(v.unwrap()).toEqual([1, 2])
  })

  it('object of Values unwraps recursively', () => {
    const v = Value.of({ a: Value.of(1, []), b: Value.of(2, []) }, [])
    expect(v.unwrap()).toEqual({ a: 1, b: 2 })
  })
})
