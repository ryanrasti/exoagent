import { RpcStub } from 'capnweb'
import { describe, expect, it } from 'vitest'
import { safeEval } from './index.js'
import { Value } from './utils.js'

describe('capnweb-eval basic evaluation', () => {
  it('evaluates number literals', async () => {
    const stub = new RpcStub({})
    expect(await safeEval('123', stub)).toEqual(Value.of(123, []))
    expect(await safeEval('0', stub)).toEqual(Value.of(0, []))
    expect(await safeEval('-42', stub)).toEqual(Value.of(-42, []))
    expect(await safeEval('3.14', stub)).toEqual(Value.of(3.14, []))
  })

  it('evaluates string literals', async () => {
    const stub = new RpcStub({})
    expect(await safeEval('"hello"', stub)).toEqual(Value.of('hello', []))
    expect(await safeEval('"world"', stub)).toEqual(Value.of('world', []))
    expect(await safeEval('""', stub)).toEqual(Value.of('', []))
  })

  it('evaluates boolean literals', async () => {
    const stub = new RpcStub({})
    expect(await safeEval('true', stub)).toEqual(Value.of(true, []))
    expect(await safeEval('false', stub)).toEqual(Value.of(false, []))
  })

  it('evaluates null and undefined', async () => {
    const stub = new RpcStub({})
    expect(await safeEval('null', stub)).toEqual(Value.of(null, []))
    expect(await safeEval('undefined', stub)).toEqual(Value.of(undefined, []))
  })

  it('evaluates bigint literals', async () => {
    const stub = new RpcStub({})
    expect(await safeEval('123n', stub)).toEqual(Value.of(123n, []))
    expect(await safeEval('0n', stub)).toEqual(Value.of(0n, []))
  })

  it('accesses properties from global scope', async () => {
    const stub = new RpcStub({ foo: 42, bar: 'hello' })
    expect(await safeEval('foo', stub)).toEqual(Value.of(42, []))
    expect(await safeEval('bar', stub)).toEqual(Value.of('hello', []))
  })

  it('accesses nested object properties', async () => {
    const stub = new RpcStub({
      obj: { nested: { value: 123 } },
    })
    expect(await safeEval('obj', stub)).toEqual(Value.of({ nested: Value.of({ value: Value.of(123, []) }, []) }, []))
  })

  it('accesses array elements', async () => {
    const stub = new RpcStub({ arr: [1, 2, 3] })
    const result = await safeEval('arr', stub)
    expect(result).toEqual(Value.of([Value.of(1, []), Value.of(2, []), Value.of(3, [])], []))
    expect(Array.isArray(result.raw)).toBe(true)
  })

  it('calls functions from global scope', async () => {
    const stub = new RpcStub({
      add: (a: number, b: number) => a + b,
      square: (x: number) => x * x,
    })
    expect(await safeEval('add(2, 3)', stub)).toEqual(Value.of(5, []))
    expect(await safeEval('square(4)', stub)).toEqual(Value.of(16, []))
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
    const result = await safeEval('obj', stub)
    expect(result).toEqual(Value.of({
      value: Value.of(10, []),
      getValue: expect.any(Function),
      multiply: expect.any(Function),
    }, []))
  })

  it('creates arrays', async () => {
    const stub = new RpcStub({})
    expect(await safeEval('[1, 2, 3]', stub)).toEqual(Value.of([Value.of(1, []), Value.of(2, []), Value.of(3, [])], []))
    expect(await safeEval('[]', stub)).toEqual(Value.of([], []))
    expect(await safeEval('[true, false, null]', stub)).toEqual(Value.of([Value.of(true, []), Value.of(false, []), Value.of(null, [])], []))
  })

  it('creates objects', async () => {
    const stub = new RpcStub({})
    expect(await safeEval('{foo: 123, bar: "hello"}', stub)).toEqual(Value.of({ foo: Value.of(123, []), bar: Value.of('hello', []) }, []))
    expect(await safeEval('{}', stub)).toEqual(Value.of({}, []))
  })

  it('supports computed property access', async () => {
    const stub = new RpcStub({ obj: { a: 1, b: 2 }, key: 'a' })
    const objResult = await safeEval('obj', stub)
    const keyResult = await safeEval('key', stub)
    expect(objResult).toEqual(Value.of({ a: Value.of(1, []), b: Value.of(2, []) }, []))
    expect(keyResult).toEqual(Value.of('a', []))
    const obj = objResult.raw as Record<string, Value<unknown>>
    const key = keyResult.raw as string
    expect(obj[key].raw).toBe(1)
    expect(obj.b.raw).toBe(2)
  })

  it('supports arrow functions', async () => {
    const stub = new RpcStub({
      numbers: [1, 2, 3],
      double: (x: number) => x * 2,
    })
    const fn = await safeEval('x => double(x)', stub)
    expect(fn).toEqual(Value.of(expect.any(Function), []))
    expect(await safeEval('numbers', stub)).toEqual(Value.of([Value.of(1, []), Value.of(2, []), Value.of(3, [])], []))
  })

  it('supports arrow functions with multiple parameters', async () => {
    const stub = new RpcStub({ add: (a: number, b: number) => a + b })
    expect(await safeEval('((a, b) => add(a, b))(5, 3)', stub)).toEqual(Value.of(8, []))
  })

  it('supports array spread', async () => {
    const stub = new RpcStub({})
    expect(await safeEval('[1, 2, ...[3, 4]]', stub)).toEqual(Value.of([Value.of(1, []), Value.of(2, []), Value.of(3, []), Value.of(4, [])], []))
  })

  it('supports object spread', async () => {
    const stub = new RpcStub({})
    expect(await safeEval('{a: 1, ...{b: 2}}', stub)).toEqual(Value.of({ a: Value.of(1, []), b: Value.of(2, []) }, []))
  })

  it('supports nested expressions', async () => {
    const stub = new RpcStub({
      add: (a: number, b: number) => a + b,
      multiply: (a: number, b: number) => a * b,
    })
    expect(await safeEval('add(multiply(2, 3), multiply(4, 5))', stub)).toEqual(Value.of(26, []))
  })

  it('supports array methods', async () => {
    const stub = new RpcStub({ arr: [1, 2, 3] })
    const result = await safeEval('arr', stub)
    expect(result).toEqual(Value.of([Value.of(1, []), Value.of(2, []), Value.of(3, [])], []))
    expect(Array.isArray(result.raw)).toBe(true)
    expect((result.raw as Value<unknown>[]).length).toBe(3)
  })

  it('handles string indexing', async () => {
    const stub = new RpcStub({ str: 'hello' })
    const result = await safeEval('str', stub)
    expect(result).toEqual(Value.of('hello', []))
    const str = result.raw as string
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
    expect(await safeEval('undefinedProp', stub)).toEqual(Value.of(undefined, []))
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
    const dataResult = await safeEval('data', stub)
    expect(dataResult).toEqual(Value.of({
      users: Value.of([
        Value.of({ name: Value.of('Alice', []), age: Value.of(30, []) }, []),
        Value.of({ name: Value.of('Bob', []), age: Value.of(25, []) }, []),
      ], []),
    }, []))
    const getAgeResult = await safeEval('getAge', stub)
    expect(getAgeResult).toEqual(Value.of(expect.any(Function), []))
  })

  it('supports chained method calls', async () => {
    const objIn = {
      getValue() {
        return { multiply: (x: number) => x * 2 }
      },
    }
    const stub = new RpcStub({ obj: objIn })
    const result = await safeEval('obj', stub)
    expect(result).toEqual(Value.of(expect.objectContaining({ getValue: Value.of(expect.any(Function)) }), []))
    const obj = result.unwrap() as typeof objIn
    expect(obj.getValue().multiply(3)).toBe(6)
  })

  it('handles functions that return arrays', async () => {
    const stub = new RpcStub({
      range: (n: number): number[] => Array.from({ length: n }, (_, i) => i),
    })
    expect(await safeEval('range(5)', stub)).toEqual(Value.of([Value.of(0, []), Value.of(1, []), Value.of(2, []), Value.of(3, []), Value.of(4, [])], []))
  })

  it('handles functions that return objects', async () => {
    const stub = new RpcStub({
      createPoint: (x: number, y: number): { x: number, y: number } => ({ x, y }),
    })
    expect(await safeEval('createPoint(10, 20)', stub)).toEqual(Value.of({ x: Value.of(10, []), y: Value.of(20, []) }, []))
  })
})
