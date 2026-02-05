import { RpcStub } from 'capnweb'
import { describe, expect, it } from 'vitest'
import { safeEval, unwrap } from './index.js'

const v = (r: Awaited<ReturnType<typeof safeEval>>) => unwrap(r)

describe('capnweb-eval basic evaluation', () => {
  it('evaluates number literals', async () => {
    const stub = new RpcStub({})
    expect(v(await safeEval('123', stub))).toBe(123)
    expect(v(await safeEval('0', stub))).toBe(0)
    expect(v(await safeEval('-42', stub))).toBe(-42)
    expect(v(await safeEval('3.14', stub))).toBe(3.14)
  })

  it('evaluates string literals', async () => {
    const stub = new RpcStub({})
    expect(v(await safeEval('"hello"', stub))).toBe('hello')
    expect(v(await safeEval('"world"', stub))).toBe('world')
    expect(v(await safeEval('""', stub))).toBe('')
  })

  it('evaluates boolean literals', async () => {
    const stub = new RpcStub({})
    expect(v(await safeEval('true', stub))).toBe(true)
    expect(v(await safeEval('false', stub))).toBe(false)
  })

  it('evaluates null and undefined', async () => {
    const stub = new RpcStub({})
    expect(v(await safeEval('null', stub))).toBe(null)
    const result = await safeEval('undefined', stub)
    expect(v(result)).toBe(undefined)
  })

  it('evaluates bigint literals', async () => {
    const stub = new RpcStub({})
    expect(v(await safeEval('123n', stub))).toBe(123n)
    expect(v(await safeEval('0n', stub))).toBe(0n)
  })

  it('accesses properties from global scope', async () => {
    const stub = new RpcStub({ foo: 42, bar: 'hello' })
    expect(v(await safeEval('foo', stub))).toBe(42)
    expect(v(await safeEval('bar', stub))).toBe('hello')
  })

  it('accesses nested object properties', async () => {
    const stub = new RpcStub({
      obj: { nested: { value: 123 } },
    })
    const obj = v(await safeEval('obj', stub))
    expect(obj).toEqual({ nested: { value: 123 } })
  })

  it('accesses array elements', async () => {
    const stub = new RpcStub({ arr: [1, 2, 3] })
    const arr = v(await safeEval('arr', stub))
    expect(arr).toEqual([1, 2, 3])
    expect(Array.isArray(arr)).toBe(true)
  })

  it('calls functions from global scope', async () => {
    const stub = new RpcStub({
      add: (a: number, b: number) => a + b,
      square: (x: number) => x * x,
    })
    expect(v(await safeEval('add(2, 3)', stub))).toBe(5)
    expect(v(await safeEval('square(4)', stub))).toBe(16)
  })

  it('calls methods on objects', async () => {
    const stub = new RpcStub({
      obj: {
        value: 10,
        getValue(this: { value: number }) {
          return this.value
        },
        multiply(this: { value: number }, x: number) {
          return this.value * x
        },
      },
    })
    const obj = v(await safeEval('obj', stub)) as Record<string, unknown>
    expect(typeof obj).toBe('object')
    expect(obj).toHaveProperty('getValue')
    expect(obj).toHaveProperty('multiply')
  })

  it('creates arrays', async () => {
    const stub = new RpcStub({})
    expect(v(await safeEval('[1, 2, 3]', stub))).toEqual([1, 2, 3])
    expect(v(await safeEval('[]', stub))).toEqual([])
    expect(v(await safeEval('[true, false, null]', stub))).toEqual([true, false, null])
  })

  it('creates objects', async () => {
    const stub = new RpcStub({})
    expect(v(await safeEval('{foo: 123, bar: "hello"}', stub))).toEqual({ foo: 123, bar: 'hello' })
    expect(v(await safeEval('{}', stub))).toEqual({})
  })

  it('supports computed property access', async () => {
    const stub = new RpcStub({ obj: { a: 1, b: 2 }, key: 'a' })
    const obj = v(await safeEval('obj', stub)) as Record<string, unknown>
    const key = v(await safeEval('key', stub)) as string
    expect(obj[key]).toBe(1)
    expect(obj.b).toBe(2)
  })

  it('supports arrow functions', async () => {
    const stub = new RpcStub({
      numbers: [1, 2, 3],
      double: (x: number) => x * 2,
    })
    const fn = await safeEval('x => double(x)', stub)
    expect(typeof v(fn)).toBe('function')
    const numbers = v(await safeEval('numbers', stub))
    expect(Array.isArray(numbers)).toBe(true)
  })

  it('supports arrow functions with multiple parameters', async () => {
    const stub = new RpcStub({ add: (a: number, b: number) => a + b })
    expect(v(await safeEval('((a, b) => add(a, b))(5, 3)', stub))).toBe(8)
  })

  it('supports array spread', async () => {
    const stub = new RpcStub({})
    expect(v(await safeEval('[1, 2, ...[3, 4]]', stub))).toEqual([1, 2, 3, 4])
  })

  it('supports object spread', async () => {
    const stub = new RpcStub({})
    expect(v(await safeEval('{a: 1, ...{b: 2}}', stub))).toEqual({ a: 1, b: 2 })
  })

  it('supports nested expressions', async () => {
    const stub = new RpcStub({
      add: (a: number, b: number) => a + b,
      multiply: (a: number, b: number) => a * b,
    })
    expect(v(await safeEval('add(multiply(2, 3), multiply(4, 5))', stub))).toBe(26)
  })

  it('supports array methods', async () => {
    const stub = new RpcStub({ arr: [1, 2, 3] })
    const arr = v(await safeEval('arr', stub)) as unknown[]
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.length).toBe(3)
  })

  it('handles string indexing', async () => {
    const stub = new RpcStub({ str: 'hello' })
    const str = v(await safeEval('str', stub)) as string
    expect(typeof str).toBe('string')
    expect(str[0]).toBe('h')
    expect(str[4]).toBe('o')
  })
})

describe('capnweb-eval error handling', () => {
  it('throws on invalid syntax', () => {
    const stub = new RpcStub({})
    expect(() => safeEval('{', stub)).toThrow()
  })

  it('returns undefined for undefined properties', async () => {
    const stub = new RpcStub({})
    const result = await safeEval('undefinedProp', stub)
    expect(v(result)).toBe(undefined)
  })

  it('throws on unsafe member access', () => {
    expect(() => {
      const testStub = new RpcStub({ test: 123 })
      return safeEval('test', testStub)
    }).not.toThrow()
  })

  it('throws on RegExp literals', () => {
    const stub = new RpcStub({})
    expect(() => safeEval('/test/', stub)).toThrow(/RegExp literals are not allowed/)
  })
})

describe('capnweb-eval complex scenarios', () => {
  it('evaluates complex nested expressions', async () => {
    const stub = new RpcStub({
      data: {
        users: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
      },
      getAge: (user: { age: number }) => user.age,
    })
    const data = v(await safeEval('data', stub))
    expect(data).toHaveProperty('users')
    const getAge = v(await safeEval('getAge', stub))
    expect(typeof getAge).toBe('function')
  })

  it('supports chained method calls', async () => {
    const objIn = {
      getValue() {
        return { multiply: (x: number) => x * 2 }
      },
    }
    const stub = new RpcStub({ obj: objIn })
    const obj = v(await safeEval('obj', stub)) as Record<string, unknown>
    expect((obj as typeof objIn).getValue().multiply(3)).toBe(6)
  })

  it('handles functions that return arrays', async () => {
    const stub = new RpcStub({
      range: (n: number): number[] => Array.from({ length: n }, (_, i) => i),
    })
    expect(v(await safeEval('range(5)', stub))).toEqual([0, 1, 2, 3, 4])
  })

  it('handles functions that return objects', async () => {
    const stub = new RpcStub({
      createPoint: (x: number, y: number): { x: number, y: number } => ({ x, y }),
    })
    expect(v(await safeEval('createPoint(10, 20)', stub))).toEqual({ x: 10, y: 20 })
  })
})
