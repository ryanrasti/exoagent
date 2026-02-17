import { describe, expect, it, beforeAll } from 'vitest'
import { Value, safeEval, GlobalScope } from './index'
import { ArrayValue, registerArrayValueFactory } from './builtins'

beforeAll(() => {
  registerArrayValueFactory()
})

describe('ArrayValue', () => {
  describe('Value.of returns ArrayValue for arrays', () => {
    it('creates ArrayValue for array input', () => {
      const arr = Value.of([1, 2, 3], ['test'])
      expect(arr).toBeInstanceOf(ArrayValue)
    })

    it('preserves taints on ArrayValue', () => {
      const arr = Value.of([1, 2, 3], [['source', { principals: ['alice'] }]])
      expect(arr.getTaints()).toEqual([['source', { principals: ['alice'] }]])
    })
  })

  describe('map', () => {
    it('transforms elements', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.map(x => x * 2)
      expect(result.raw.map(v => v.raw)).toEqual([2, 4, 6])
    })

    it('propagates taints from source array', () => {
      const arr = Value.of([1, 2, 3], ['source']) as ArrayValue<number>
      const result = arr.map(x => x * 2)
      expect(result.getTaints()).toEqual([['source', {}]])
    })

    it('returns ArrayValue for chaining', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.map(x => x * 2)
      expect(result).toBeInstanceOf(ArrayValue)
    })
  })

  describe('filter', () => {
    it('filters elements', () => {
      const arr = Value.of([1, 2, 3, 4, 5], []) as ArrayValue<number>
      const result = arr.filter(x => x > 2)
      expect(result.raw.map(v => v.raw)).toEqual([3, 4, 5])
    })

    it('propagates taints', () => {
      const arr = Value.of([1, 2, 3], ['source']) as ArrayValue<number>
      const result = arr.filter(x => x > 1)
      expect(result.getTaints()).toEqual([['source', {}]])
    })

    it('returns ArrayValue for chaining', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.filter(x => x > 1)
      expect(result).toBeInstanceOf(ArrayValue)
    })
  })

  describe('find', () => {
    it('finds matching element', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.find(x => x === 2)
      expect(result.raw).toBe(2)
    })

    it('returns undefined when not found', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.find(x => x === 99)
      expect(result.raw).toBeUndefined()
    })

    it('propagates taints', () => {
      const arr = Value.of([1, 2, 3], ['source']) as ArrayValue<number>
      const result = arr.find(x => x === 2)
      expect(result.getTaints()).toEqual([['source', {}]])
    })
  })

  describe('some', () => {
    it('returns true when some match', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.some(x => x > 2)
      expect(result.raw).toBe(true)
    })

    it('returns false when none match', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.some(x => x > 10)
      expect(result.raw).toBe(false)
    })

    it('propagates taints', () => {
      const arr = Value.of([1, 2, 3], ['source']) as ArrayValue<number>
      const result = arr.some(x => x > 2)
      expect(result.getTaints()).toEqual([['source', {}]])
    })
  })

  describe('every', () => {
    it('returns true when all match', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.every(x => x > 0)
      expect(result.raw).toBe(true)
    })

    it('returns false when some do not match', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.every(x => x > 1)
      expect(result.raw).toBe(false)
    })

    it('propagates taints', () => {
      const arr = Value.of([1, 2, 3], ['source']) as ArrayValue<number>
      const result = arr.every(x => x > 0)
      expect(result.getTaints()).toEqual([['source', {}]])
    })
  })

  describe('at', () => {
    it('gets element at positive index', () => {
      const arr = Value.of([10, 20, 30], []) as ArrayValue<number>
      expect(arr.at(1).raw).toBe(20)
    })

    it('gets element at negative index', () => {
      const arr = Value.of([10, 20, 30], []) as ArrayValue<number>
      expect(arr.at(-1).raw).toBe(30)
    })

    it('returns undefined for out of bounds', () => {
      const arr = Value.of([10, 20, 30], []) as ArrayValue<number>
      expect(arr.at(99).raw).toBeUndefined()
    })

    it('propagates taints', () => {
      const arr = Value.of([10, 20, 30], ['source']) as ArrayValue<number>
      expect(arr.at(0).getTaints()).toEqual([['source', {}]])
    })
  })

  describe('slice', () => {
    it('slices with start and end', () => {
      const arr = Value.of([1, 2, 3, 4, 5], []) as ArrayValue<number>
      const result = arr.slice(1, 4)
      expect(result.raw.map(v => v.raw)).toEqual([2, 3, 4])
    })

    it('slices with only start', () => {
      const arr = Value.of([1, 2, 3, 4, 5], []) as ArrayValue<number>
      const result = arr.slice(2)
      expect(result.raw.map(v => v.raw)).toEqual([3, 4, 5])
    })

    it('slices with no args (clone)', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.slice()
      expect(result.raw.map(v => v.raw)).toEqual([1, 2, 3])
    })

    it('propagates taints', () => {
      const arr = Value.of([1, 2, 3], ['source']) as ArrayValue<number>
      const result = arr.slice(0, 2)
      expect(result.getTaints()).toEqual([['source', {}]])
    })

    it('returns ArrayValue for chaining', () => {
      const arr = Value.of([1, 2, 3], []) as ArrayValue<number>
      const result = arr.slice(0, 2)
      expect(result).toBeInstanceOf(ArrayValue)
    })
  })

  describe('chaining', () => {
    it('chains filter and map', () => {
      const arr = Value.of([1, 2, 3, 4, 5], ['source']) as ArrayValue<number>
      const result = arr.filter(x => x > 2).map(x => x * 10)
      expect(result.raw.map(v => v.raw)).toEqual([30, 40, 50])
      expect(result.getTaints()).toEqual([['source', {}]])
    })

    it('chains map and filter', () => {
      const arr = Value.of([1, 2, 3, 4, 5], []) as ArrayValue<number>
      const result = arr.map(x => x * 2).filter(x => x > 5)
      expect(result.raw.map(v => v.raw)).toEqual([6, 8, 10])
    })

    it('chains slice and map', () => {
      const arr = Value.of([1, 2, 3, 4, 5], []) as ArrayValue<number>
      const result = arr.slice(1, 4).map(x => x * 2)
      expect(result.raw.map(v => v.raw)).toEqual([4, 6, 8])
    })
  })
})

describe('ArrayValue in safeEval', () => {
  it('evaluates map in sandbox', async () => {
    const scope = new GlobalScope(Value.of({ nums: [1, 2, 3] }, ['test']))
    const result = await safeEval('nums.map(x => x * 2)', scope)
    expect(result.raw.map((v: Value) => v.raw)).toEqual([2, 4, 6])
    expect(result.getTaints()).toEqual([['test', {}]])
  })

  it('evaluates filter in sandbox', async () => {
    const scope = new GlobalScope(Value.of({ nums: [1, 2, 3, 4, 5] }, ['test']))
    const result = await safeEval('nums.filter(x => x > 2)', scope)
    expect(result.raw.map((v: Value) => v.raw)).toEqual([3, 4, 5])
  })

  it('evaluates chained operations in sandbox', async () => {
    const scope = new GlobalScope(Value.of({ nums: [1, 2, 3, 4, 5] }, ['source']))
    const result = await safeEval('nums.filter(x => x > 2).map(x => x * 10)', scope)
    expect(result.raw.map((v: Value) => v.raw)).toEqual([30, 40, 50])
    expect(result.getTaints()).toEqual([['source', {}]])
  })

  it('evaluates find in sandbox', async () => {
    const scope = new GlobalScope(Value.of({ nums: [1, 2, 3] }, []))
    const result = await safeEval('nums.find(x => x === 2)', scope)
    expect(result.raw).toBe(2)
  })

  it('evaluates some in sandbox', async () => {
    const scope = new GlobalScope(Value.of({ nums: [1, 2, 3] }, []))
    const result = await safeEval('nums.some(x => x > 2)', scope)
    expect(result.raw).toBe(true)
  })

  it('evaluates every in sandbox', async () => {
    const scope = new GlobalScope(Value.of({ nums: [1, 2, 3] }, []))
    const result = await safeEval('nums.every(x => x > 0)', scope)
    expect(result.raw).toBe(true)
  })

  it('evaluates at in sandbox', async () => {
    const scope = new GlobalScope(Value.of({ nums: [10, 20, 30] }, []))
    const result = await safeEval('nums.at(-1)', scope)
    expect(result.raw).toBe(30)
  })

  it('evaluates slice in sandbox', async () => {
    const scope = new GlobalScope(Value.of({ nums: [1, 2, 3, 4, 5] }, []))
    const result = await safeEval('nums.slice(1, 3)', scope)
    expect(result.raw.map((v: Value) => v.raw)).toEqual([2, 3])
  })

  it('works with object arrays', async () => {
    const scope = new GlobalScope(Value.of({
      users: [
        { name: 'alice', age: 30 },
        { name: 'bob', age: 25 },
        { name: 'charlie', age: 35 },
      ],
    }, ['pii']))

    const result = await safeEval('users.filter(u => u.age > 28).map(u => u.name)', scope)
    expect(result.raw.map((v: Value) => v.raw)).toEqual(['alice', 'charlie'])
    expect(result.getTaints()).toEqual([['pii', {}]])
  })

  it('propagates taints through complex chains', async () => {
    const scope = new GlobalScope(Value.of({
      items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    }, [['sensitive', { principals: ['admin'] }]]))

    const result = await safeEval(
      'items.filter(x => x > 3).slice(0, 3).map(x => x * 2)',
      scope,
    )
    expect(result.raw.map((v: Value) => v.raw)).toEqual([8, 10, 12])
    expect(result.getTaints()).toEqual([['sensitive', { principals: ['admin'] }]])
  })
})
