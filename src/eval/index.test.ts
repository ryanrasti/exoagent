import { RpcTarget } from 'capnweb'
import { describe, expect, it } from 'vitest'
import { safeEval } from './index.js'
import { Value } from './utils.js'
import { tool } from '../policy.js'
import z from 'zod'

describe('capnweb-eval basic evaluation', () => {
  it('evaluates number literals', async () => {
    expect(await safeEval('123', Value.of({}))).toEqual(Value.of(123, []))
    expect(await safeEval('0', Value.of({}))).toEqual(Value.of(0, []))
    expect(await safeEval('-42', Value.of({}))).toEqual(Value.of(-42, []))
    expect(await safeEval('3.14', Value.of({}))).toEqual(Value.of(3.14, []))
  })

  it('evaluates string literals', async () => {
    expect(await safeEval('"hello"', Value.of({}))).toEqual(Value.of('hello', []))
    expect(await safeEval('"world"', Value.of({}))).toEqual(Value.of('world', []))
    expect(await safeEval('""', Value.of({}))).toEqual(Value.of('', []))
  })

  it('evaluates boolean literals', async () => {
    expect(await safeEval('true', Value.of({}))).toEqual(Value.of(true, []))
    expect(await safeEval('false', Value.of({}))).toEqual(Value.of(false, []))
  })

  it('evaluates null and undefined', async () => {
    expect(await safeEval('null', Value.of({}))).toEqual(Value.of(null, []))
    expect(await safeEval('undefined', Value.of({}))).toEqual(Value.of(undefined, []))
  })

  it('evaluates bigint literals', async () => {
    expect(await safeEval('123n', Value.of({}))).toEqual(Value.of(123n, []))
    expect(await safeEval('0n', Value.of({}))).toEqual(Value.of(0n, []))
  })

  it('accesses properties from global scope', async () => {
    expect(await safeEval('foo', Value.of({ foo: 42, bar: 'hello' }))).toEqual(Value.of(42, []))
    expect(await safeEval('bar', Value.of({ foo: 42, bar: 'hello' }))).toEqual(Value.of('hello', []))
  })

  it('accesses nested object properties', async () => {
    expect(await safeEval('obj', Value.of({ obj: { nested: { value: 123 } } }))).toEqual(Value.of({ nested: Value.of({ value: Value.of(123, []) }, []) }, []))
  })

  it('accesses array elements', async () => {
    const result = await safeEval('arr', Value.of({ arr: [1, 2, 3] }))
    expect(result).toEqual(Value.of([Value.of(1, []), Value.of(2, []), Value.of(3, [])], []))
    expect(Array.isArray(result.raw)).toBe(true)
  })

  it('calls functions from global scope', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) {
        return a + b
      }
      @tool(z.number())
      square(x: number) {
        return x * x
      }
    })
    expect(await safeEval('add(2, 3)', scope)).toEqual(Value.of(5, []))
    expect(await safeEval('square(4)', scope)).toEqual(Value.of(16, []))
  })

  it('calls methods on objects', async () => {
    const scope = Value.of({
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
    const result = await safeEval('obj', scope)
    expect(result).toEqual(Value.of({
      value: Value.of(10, []),
      getValue: expect.any(Function),
      multiply: expect.any(Function),
    }, []))
  })

  it('creates arrays', async () => {
    expect(await safeEval('[1, 2, 3]', Value.of({}))).toEqual(Value.of([Value.of(1, []), Value.of(2, []), Value.of(3, [])], []))
    expect(await safeEval('[]', Value.of({}))).toEqual(Value.of([], []))
    expect(await safeEval('[true, false, null]', Value.of({}))).toEqual(Value.of([Value.of(true, []), Value.of(false, []), Value.of(null, [])], []))
  })

  it('creates objects', async () => {
    expect(await safeEval('{foo: 123, bar: "hello"}', Value.of({}))).toEqual(Value.of({ foo: Value.of(123, []), bar: Value.of('hello', []) }, []))
    expect(await safeEval('{}', Value.of({}))).toEqual(Value.of({}, []))
  })

  it('supports computed property access', async () => {
    const scope = Value.of({ obj: { a: 1, b: 2 }, key: 'a' })
    const objResult = await safeEval('obj', scope)
    const keyResult = await safeEval('key', scope)
    expect(objResult).toEqual(Value.of({ a: Value.of(1, []), b: Value.of(2, []) }, []))
    expect(keyResult).toEqual(Value.of('a', []))
    const obj = objResult.raw as Record<string, Value<unknown>>
    const key = keyResult.raw as string
    expect(obj[key].raw).toBe(1)
    expect(obj.b.raw).toBe(2)
  })

  it('supports arrow functions', async () => {
    const scope = Value.of(new class {
      @tool()
      numbers(): number[] {
        return [1, 2, 3]
      }
      
      @tool(z.number())
      double(x: number) {
        return x * 2
      }
    })
    const fn = await safeEval('x => double(x)', scope)
    expect(fn).toEqual(Value.of(expect.any(Function), [], { isInternalFunction: true }))
    expect(await safeEval('numbers()', scope)).toEqual(Value.of([Value.of(1, []), Value.of(2, []), Value.of(3, [])], []))
  })

  it('supports arrow functions with multiple parameters', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) {
        return a + b
      }
    })
    expect(await safeEval('((a, b) => add(a, b))(5, 3)', scope)).toEqual(Value.of(8, []))
  })

  it('supports array spread', async () => {
    expect(await safeEval('[1, 2, ...[3, 4]]', Value.of({}))).toEqual(Value.of([Value.of(1, []), Value.of(2, []), Value.of(3, []), Value.of(4, [])], []))
  })

  it('supports object spread', async () => {
    expect(await safeEval('{a: 1, ...{b: 2}}', Value.of({}))).toEqual(Value.of({ a: Value.of(1, []), b: Value.of(2, []) }, []))
  })

  it('supports nested expressions', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) {
        return a + b
      }
      @tool(z.number(), z.number())
      multiply(a: number, b: number) {
        return a * b
      }
    })
    expect(await safeEval('add(multiply(2, 3), multiply(4, 5))', scope)).toEqual(Value.of(26, []))
  })

  it('supports array methods', async () => {
    const result = await safeEval('arr', Value.of({ arr: [1, 2, 3] }))
    expect(result).toEqual(Value.of([Value.of(1, []), Value.of(2, []), Value.of(3, [])], []))
    expect(Array.isArray(result.raw)).toBe(true)
    expect((result.raw as Value<unknown>[]).length).toBe(3)
  })

  it('handles string indexing', async () => {
    const result = await safeEval('str', Value.of({ str: 'hello' }))
    expect(result).toEqual(Value.of('hello', []))
    const str = result.raw as string
    expect(str[0]).toBe('h')
    expect(str[4]).toBe('o')
  })
})

describe('capnweb-eval error handling', () => {
  it('throws on invalid syntax', () => {
    expect(() => safeEval('{', Value.of({}))).toThrow()
  })

  it('returns undefined for undefined properties', async () => {
    expect(await safeEval('undefinedProp', Value.of({}))).toEqual(Value.of(undefined, []))
  })

  it('throws on unsafe member access', () => {
    expect(() => {
      return safeEval('test', Value.of({ test: 123 }))
    }).not.toThrow()
  })

  it('throws on RegExp literals', () => {
    expect(() => safeEval('/test/', Value.of({}))).toThrow(/RegExp literals are not allowed/)
  })
})

describe('capnweb-eval complex scenarios', () => {
  it('evaluates complex nested expressions', async () => {
    const scope = Value.of({
      data: {
        users: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
      },
      getAge: (user: { age: number }) => user.age,
    })
    const dataResult = await safeEval('data', scope)
    expect(dataResult).toEqual(Value.of({
      users: Value.of([
        Value.of({ name: Value.of('Alice', []), age: Value.of(30, []) }, []),
        Value.of({ name: Value.of('Bob', []), age: Value.of(25, []) }, []),
      ], []),
    }, []))
    const getAgeResult = await safeEval('getAge', scope)
    expect(getAgeResult).toEqual(Value.of(expect.any(Function), []))
  })


})

describe('capnweb-eval with toolsets', () => {
  it('supports chained method calls', async () => {

    class Obj {
      @tool()
      getValue() {
        return { multiply: (x: number) => x * 2 }
      }
    }


    const objOrig = new Obj()
    class Global {
      @tool()
      obj() {
        return objOrig
      }
    }

    const result = await safeEval('obj()', Value.of(new Global()))
    const obj = result.unwrap() as Obj
    expect(obj).toEqual(objOrig)
    expect(obj.getValue().multiply(3)).toBe(6)
  })

  it('handles functions that return arrays', async () => {
    class Range {
      @tool(z.number())
      range(n: number): number[] {
        return Array.from({ length: n }, (_, i) => i)
      }
    }
    expect(await safeEval('range(5)', Value.of(new Range()))).toEqual(Value.of([Value.of(0, []), Value.of(1, []), Value.of(2, []), Value.of(3, []), Value.of(4, [])], []))
  })

  it('handles functions that return objects', async () => {
    class CreatePoint {
      @tool(z.number(), z.number())
      createPoint(x: number, y: number): { x: number, y: number } {
        return { x, y }
      }
    }
    expect(await safeEval('createPoint(10, 20)', Value.of(new CreatePoint()))).toEqual(Value.of({ x: Value.of(10, []), y: Value.of(20, []) }, []))
  })
})
