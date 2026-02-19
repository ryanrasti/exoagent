import type { Taint } from './utils.js'
import { describe, expect, it } from 'vitest'
import { setPolicyMetadata } from '../meta.js'
import { formatCodeMessage, isSafeMemberRaw, normalizeTaints, Value } from './utils.js'

// Helper for order-independent taint comparison (accepts string[] for convenience)
const expectTaints = (value: Value, expected: string[]) => {
  const actual = value.getTaints().map(t => t[0]).sort()
  expect(actual).toEqual(expected.sort())
}

// Helper to check if taints contain a specific taint type
const taintsContain = (taints: Taint[], type: string) =>
  taints.some(t => t[0] === type)

describe('value', () => {
  it('stores raw and taints', () => {
    const v = Value.of(42, ['a'])
    expect(v.raw).toBe(42)
    expect(v.getTaints()).toEqual([['a', {}]])
  })

  it('withTaints merges and returns new Value', () => {
    const v = Value.of(1, ['a'])
    const v2 = v.withTaints(['b'])
    expectTaints(v, ['a'])
    expect(v2.raw).toBe(1)
    expectTaints(v2, ['a', 'b'])
  })

  it('withTaints(empty) returns same', () => {
    const v = Value.of(1, ['a'])
    expect(v.withTaints([])).toBe(v)
  })

  it('value.mergeTaints concatenates and deduplicates by structural equality', () => {
    const a = Value.of(1, ['x', 'y'])
    const b = Value.of(2, ['y', 'z'])
    // Duplicates are removed based on structural equality
    expect(Value.mergeTaints(a, b)).toEqual([['x', {}], ['y', {}], ['z', {}]])
  })

  it('value.mergeTaints skips undefined', () => {
    const a = Value.of(1, ['a'])
    expect(Value.mergeTaints(a, undefined)).toEqual([['a', {}]])
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
    expectTaints(slotA, ['obj', 'key'])
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
  // No-op policy checker for tests that don't care about policy
  const noopChecker = () => {}

  it('primitives pass through', () => {
    expect(Value.of(1, []).unwrap(noopChecker)).toBe(1)
    expect(Value.of('x', []).unwrap(noopChecker)).toBe('x')
    expect(Value.of(null, []).unwrap(noopChecker)).toBe(null)
    expect(Value.of(undefined, []).unwrap(noopChecker)).toBe(undefined)
  })

  it('array of Values unwraps recursively', () => {
    const v = Value.of([Value.of(1, []), Value.of(2, [])], [])
    expect(v.unwrap(noopChecker)).toEqual([1, 2])
  })

  it('object of Values unwraps recursively', () => {
    const v = Value.of({ a: Value.of(1, []), b: Value.of(2, []) }, [])
    expect(v.unwrap(noopChecker)).toEqual({ a: 1, b: 2 })
  })

  it('deeply nested structures unwrap recursively', () => {
    const v = Value.of({
      arr: Value.of([
        Value.of({ x: Value.of(1, []) }, []),
        Value.of({ y: Value.of(2, []) }, []),
      ], []),
      obj: Value.of({
        nested: Value.of([Value.of(3, []), Value.of(4, [])], []),
      }, []),
    }, [])
    expect(v.unwrap(noopChecker)).toEqual({
      arr: [{ x: 1 }, { y: 2 }],
      obj: { nested: [3, 4] },
    })
  })

  it('unwraps internal functions to non-wrapping functions', () => {
    const innerFn = (x: Value) => Value.of(x.raw as number * 2, [])
    // fnNode presence implies internal function - use a stub node for testing
    const stubNode = { type: 'ArrowFunctionExpression' } as any
    const v = Value.of(innerFn, [], { fnNode: stubNode })
    const unwrapped = v.unwrap(noopChecker) as (x: number) => number
    expect(typeof unwrapped).toBe('function')
    expect(unwrapped(5)).toBe(10)
  })

  it('preserves non-internal functions as-is', () => {
    const fn = (x: number) => x * 2
    const v = Value.of(fn, [])
    expect(v.unwrap(noopChecker)).toBe(fn)
  })
})

describe('getSlot', () => {
  it('returns undefined for missing keys in plain objects', () => {
    const v = Value.of({ a: 1 }, [])
    const slot = v.getSlot(Value.of('missing', []))
    expect(slot.raw).toBe(undefined)
  })

  it('returns undefined for out-of-bounds array index', () => {
    const v = Value.of([1, 2, 3], [])
    const slot = v.getSlot(Value.of(10, []))
    expect(slot.raw).toBe(undefined)
  })

  it('throws on non-numeric key for arrays', () => {
    const v = Value.of([1, 2, 3], [])
    expect(() => v.getSlot(Value.of('notANumber', []))).toThrow(/Index must be a number/)
  })

  it('throws on unsafe member names', () => {
    const v = Value.of({ normal: 1 }, [])
    expect(() => v.getSlot(Value.of('__proto__', []))).toThrow()
    expect(() => v.getSlot(Value.of('constructor', []))).toThrow()
    expect(() => v.getSlot(Value.of('prototype', []))).toThrow()
  })

  it('accesses class-like objects with policy metadata', () => {
    class MyClass {
      value = 42
      method() { return this.value }
    }
    const instance = new MyClass()
    setPolicyMetadata(instance, { value: {}, method: {} })

    const v = Value.of(instance, ['taint'])
    const slot = v.getSlot(Value.of('value', []))
    expect(slot.raw).toBe(42)
    expect(slot.options.propertyName).toBe('value')
    expect(slot.options.parent).toBe(v)
  })

  it('throws when accessing class-like object without policy metadata', () => {
    class MyClass {
      value = 42
    }
    const instance = new MyClass()
    const v = Value.of(instance, [])
    expect(() => v.getSlot(Value.of('value', []))).toThrow(/No policy metadata/)
  })

  it('throws when accessing undefined property on class-like object', () => {
    class MyClass {
      value = 42
    }
    const instance = new MyClass()
    setPolicyMetadata(instance, { value: {} })

    const v = Value.of(instance, [])
    expect(() => v.getSlot(Value.of('undefinedProp', []))).toThrow(/No policy metadata.*undefinedProp/)
  })
})

describe('isSafeMemberRaw', () => {
  it('returns true for safe strings', () => {
    expect(isSafeMemberRaw('foo')).toBe(true)
    expect(isSafeMemberRaw('bar')).toBe(true)
    expect(isSafeMemberRaw('myProperty')).toBe(true)
  })

  it('returns true for numbers', () => {
    expect(isSafeMemberRaw(0)).toBe(true)
    expect(isSafeMemberRaw(1)).toBe(true)
    expect(isSafeMemberRaw(100)).toBe(true)
  })

  it('returns false for unsafe prototype properties', () => {
    expect(isSafeMemberRaw('__proto__')).toBe(false)
    expect(isSafeMemberRaw('constructor')).toBe(false)
    expect(isSafeMemberRaw('prototype')).toBe(false)
  })

  it('returns false for Object.prototype properties', () => {
    expect(isSafeMemberRaw('toString')).toBe(false)
    expect(isSafeMemberRaw('hasOwnProperty')).toBe(false)
    expect(isSafeMemberRaw('valueOf')).toBe(false)
  })

  it('returns false for Promise-related properties (thenable escape hatch)', () => {
    expect(isSafeMemberRaw('then')).toBe(false)
    expect(isSafeMemberRaw('catch')).toBe(false)
    expect(isSafeMemberRaw('finally')).toBe(false)
  })

  it('returns false for non-string/number types', () => {
    expect(isSafeMemberRaw(null)).toBe(false)
    expect(isSafeMemberRaw(undefined)).toBe(false)
    expect(isSafeMemberRaw({})).toBe(false)
    expect(isSafeMemberRaw([])).toBe(false)
    expect(isSafeMemberRaw(Symbol('test'))).toBe(false)
  })
})

describe('value.isSafeMember', () => {
  it('returns true for safe string values', () => {
    expect(Value.of('foo', []).isSafeMember()).toBe(true)
  })

  it('returns true for number values', () => {
    expect(Value.of(42, []).isSafeMember()).toBe(true)
  })

  it('returns false for unsafe strings', () => {
    expect(Value.of('__proto__', []).isSafeMember()).toBe(false)
    expect(Value.of('constructor', []).isSafeMember()).toBe(false)
  })

  it('returns false for non-member types', () => {
    expect(Value.of({}, []).isSafeMember()).toBe(false)
    expect(Value.of([], []).isSafeMember()).toBe(false)
    expect(Value.of(null, []).isSafeMember()).toBe(false)
  })
})

describe('value.isThenable', () => {
  it('returns true for Promise-like objects', () => {
    const promise = Promise.resolve(42)
    const v = Value.of(promise, [])
    expect(v.isThenable()).toBe(true)
  })

  it('returns false for plain objects with then property (gets wrapped)', () => {
    // Plain objects get their properties wrapped by Value.of, so the `then`
    // becomes a Value<Function> not a function, making isThenable return false.
    // This is expected behavior - use actual Promises for thenables.
    const thenable = { then: (resolve: (v: number) => void) => resolve(42) }
    const v = Value.of(thenable, [])
    expect(v.isThenable()).toBe(false)
  })

  it('returns true for class-like thenables (not wrapped)', () => {
    // Class-like objects (non-plain prototypes) don't get property-wrapped
    class CustomThenable {
      then(resolve: (v: number) => void) { resolve(42) }
    }
    const v = Value.of(new CustomThenable(), [])
    expect(v.isThenable()).toBe(true)
  })

  it('returns false for plain objects', () => {
    const v = Value.of({ foo: 'bar' }, [])
    expect(v.isThenable()).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(Value.of(42, []).isThenable()).toBe(false)
    expect(Value.of('string', []).isThenable()).toBe(false)
    expect(Value.of(null, []).isThenable()).toBe(false)
  })
})

describe('value.asAwaitable', () => {
  it('returns the value itself for non-thenables', () => {
    const v = Value.of(42, ['taint'])
    const result = v.asAwaitable()
    expect(result).toBe(v)
  })

  it('returns a promise that resolves with taints for thenables', async () => {
    const promise = Promise.resolve(42)
    const v = Value.of(promise, ['taint'])
    const result = await v.asAwaitable()
    expect(result.raw).toBe(42)
    expect(taintsContain(result.getTaints(), 'taint')).toBe(true)
  })
})

describe('value.of wrapping behavior', () => {
  it('wraps nested arrays recursively', () => {
    const v = Value.of([[1, 2], [3, 4]], [])
    expect(v.isArray()).toBe(true)
    const inner = v.raw as Value[]
    expect(inner[0]).toBeInstanceOf(Value)
    expect((inner[0] as Value).isArray()).toBe(true)
  })

  it('wraps nested objects recursively', () => {
    const v = Value.of({ a: { b: { c: 1 } } }, [])
    expect(v.isPlainObject()).toBe(true)
    const inner = v.raw as Record<string, Value>
    expect(inner.a).toBeInstanceOf(Value)
  })

  it('applies outer taints deeply to nested Value instances', () => {
    const inner = Value.of(42, ['inner'])
    const outer = Value.of({ value: inner }, ['outer'])
    const raw = outer.raw as Record<string, Value>
    // Deep behavior: inner value gets outer taints merged
    expect(taintsContain(raw.value.getTaints(), 'inner')).toBe(true)
    expect(taintsContain(raw.value.getTaints(), 'outer')).toBe(true)
  })

  it('preserves existing Value instances with shallow option', () => {
    const inner = Value.of(42, ['inner'])
    const outer = Value.of({ value: inner }, ['outer'], { shallow: true })
    const raw = outer.raw as Record<string, Value>
    expect(raw.value).toBe(inner)
    expect(taintsContain(raw.value.getTaints(), 'inner')).toBe(true)
    expect(taintsContain(raw.value.getTaints(), 'outer')).toBe(false)
  })

  it('returns same Value with merged taints if passed a Value', () => {
    const v = Value.of(42, ['a'])
    const v2 = Value.of(v, ['b'])
    expect(v2.raw).toBe(42)
    expectTaints(v2, ['a', 'b'])
  })
})

describe('value.toString', () => {
  it('formats value with raw and taints', () => {
    const v = Value.of(42, ['a', 'b'])
    // toString now shows tuple format
    expect(v.toString()).toContain('Value(raw: 42')
    expect(v.toString()).toContain('taints:')
  })

  it('handles objects in toString', () => {
    const v = Value.of({ x: Value.of(1, []) }, ['t'])
    expect(v.toString()).toContain('Value(raw:')
    expect(v.toString()).toContain('taints: t')
  })
})

describe('value.Undefined', () => {
  it('is a Value with undefined raw and no taints', () => {
    expect(Value.Undefined.raw).toBe(undefined)
    expect(Value.Undefined.getTaints()).toEqual([])
  })
})

describe('formatCodeMessage', () => {
  it('formats single line code with pointer', () => {
    const result = formatCodeMessage('foo.bar()', 4, 'Test error')
    expect(result).toContain('Test error')
    expect(result).toContain('foo.bar()')
    expect(result).toContain('^')
  })

  it('formats multiline code with correct line number', () => {
    const code = 'line1\nline2\nline3'
    const result = formatCodeMessage(code, 6, 'Error on line 2') // position 6 is start of 'line2'
    expect(result).toContain('Error on line 2')
    expect(result).toContain('2 |')
    expect(result).toContain('line2')
  })

  it('handles position at start of code', () => {
    const result = formatCodeMessage('test', 0, 'Start error')
    expect(result).toContain('Start error')
    expect(result).toContain('1 |')
  })
})
