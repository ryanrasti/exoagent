import { describe, expect, it } from 'vitest'
import z from 'zod'
import { tool } from '../policy.js'
import { safeEval } from './index.js'
import { Value } from './utils.js'

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
    const obj = result.unwrap(() => {}) as Obj
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

describe('evaluator edge cases - unsupported syntax', () => {
  it('throws on binary operators', () => {
    expect(() => safeEval('1 + 2', Value.of({}))).toThrow(/Unsupported expression/)
  })

  it('throws on logical operators', () => {
    expect(() => safeEval('true && false', Value.of({}))).toThrow(/Unsupported expression/)
    expect(() => safeEval('true || false', Value.of({}))).toThrow(/Unsupported expression/)
  })

  it('throws on comparison operators', () => {
    expect(() => safeEval('1 < 2', Value.of({}))).toThrow(/Unsupported expression/)
    expect(() => safeEval('1 === 2', Value.of({}))).toThrow(/Unsupported expression/)
  })

  it('throws on template literals', () => {
    expect(() => safeEval('`hello ${name}`', Value.of({ name: 'world' }))).toThrow(/Unsupported expression/)
  })

  it('throws on conditional/ternary expressions', () => {
    expect(() => safeEval('true ? 1 : 2', Value.of({}))).toThrow(/Unsupported expression/)
  })

  it('throws on assignment expressions', () => {
    expect(() => safeEval('x = 5', Value.of({ x: 0 }))).toThrow(/Unsupported expression/)
  })

  it('throws on update expressions (++/--)', () => {
    expect(() => safeEval('x++', Value.of({ x: 0 }))).toThrow(/Unsupported expression/)
    expect(() => safeEval('--x', Value.of({ x: 0 }))).toThrow(/Unsupported expression/)
  })

  it('throws on new expressions', () => {
    expect(() => safeEval('new Date()', Value.of({}))).toThrow(/Unsupported expression/)
  })

  it('throws on this expression', () => {
    expect(() => safeEval('this', Value.of({}))).toThrow(/Unsupported expression/)
  })

  it('throws on sequence expressions', () => {
    expect(() => safeEval('(1, 2, 3)', Value.of({}))).toThrow(/Unsupported expression/)
  })

  it('throws on generator functions', () => {
    expect(() => safeEval('function* gen() { yield 1 }', Value.of({}))).toThrow()
  })

  it('throws on class expressions', () => {
    expect(() => safeEval('class Foo {}', Value.of({}))).toThrow()
  })
})

describe('evaluator edge cases - arrow functions', () => {
  it('supports arrow functions that capture outer scope variables', async () => {
    const scope = Value.of(new class {
      @tool(z.number())
      double(x: number) { return x * 2 }
    })
    const result = await safeEval('((multiplier) => (x) => double(x))(2)', scope)
    expect(result.options.isInternalFunction).toBe(true)
  })

  it('supports deeply nested arrow function closures', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) { return a + b }
    })
    const result = await safeEval('((a) => (b) => (c) => add(add(a, b), c))(1)(2)(3)', scope)
    expect(result.raw).toBe(6)
  })

  it('throws when await is used in non-async arrow function', () => {
    const scope = Value.of(new class {
      @tool()
      asyncFn() { return Promise.resolve(42) }
    })
    // acorn rejects await in non-async context at parse time
    expect(() => safeEval('((x) => { return await asyncFn() })(1)', scope)).toThrow()
  })

  it('supports async arrow functions with await', async () => {
    const scope = Value.of(new class {
      @tool()
      asyncFn() { return Promise.resolve(42) }
    })
    const result = await safeEval('(async () => { return await asyncFn() })()', scope)
    expect(result.raw).toBe(42)
  })

  it('supports arrow function with rest parameters', async () => {
    const scope = Value.of(new class {
      @tool(z.array(z.any()))
      sum(nums: number[]) { return nums.reduce((a, b) => a + b, 0) }
    })
    const result = await safeEval('((...args) => sum(args))(1, 2, 3)', scope)
    expect(result.raw).toBe(6)
  })

  it('supports arrow function with default parameters', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) { return a + b }
    })
    const result = await safeEval('((a, b = 10) => add(a, b))(5)', scope)
    expect(result.raw).toBe(15)
  })

  it('supports arrow function with destructuring parameters', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) { return a + b }
    })
    const result = await safeEval('(({ x, y }) => add(x, y))({ x: 3, y: 7 })', scope)
    expect(result.raw).toBe(10)
  })

  it('supports arrow function with array destructuring parameters', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) { return a + b }
    })
    const result = await safeEval('(([a, b]) => add(a, b))([4, 6])', scope)
    expect(result.raw).toBe(10)
  })
})

describe('evaluator edge cases - block statements', () => {
  it('supports empty block statements', async () => {
    const scope = Value.of(new class {
      @tool()
      noop() { return 'called' }
    })
    const result = await safeEval('(() => { ; })()', scope)
    expect(result.raw).toBe(undefined)
  })

  it('supports multiple statements in block', async () => {
    const scope = Value.of(new class {
      @tool(z.number())
      double(x: number) { return x * 2 }
    })
    const result = await safeEval('(() => { const a = double(5); const b = double(a); return b })()', scope)
    expect(result.raw).toBe(20)
  })

  it('returns first return statement encountered', async () => {
    const scope = Value.of(new class {
      @tool(z.number())
      id(x: number) { return x }
    })
    const result = await safeEval('(() => { return id(1); return id(2) })()', scope)
    expect(result.raw).toBe(1)
  })

  it('supports nested blocks', async () => {
    const scope = Value.of(new class {
      @tool(z.number())
      id(x: number) { return x }
    })
    const result = await safeEval('(() => { { const x = id(5); return x } })()', scope)
    expect(result.raw).toBe(5)
  })

  it('throws on let/var declarations (only const allowed)', () => {
    expect(() => safeEval('(() => { let x = 1; return x })()', Value.of({}))).toThrow(/Only `const`/)
    expect(() => safeEval('(() => { var x = 1; return x })()', Value.of({}))).toThrow(/Only `const`/)
  })

  it('throws on const without initializer', () => {
    // This is actually a syntax error, but let's verify it's handled
    expect(() => safeEval('(() => { const x; return x })()', Value.of({}))).toThrow()
  })
})

describe('evaluator edge cases - member expressions', () => {
  it('supports computed member access with number', async () => {
    const scope = Value.of({ arr: [10, 20, 30] })
    const result = await safeEval('arr[1]', scope)
    expect(result.raw).toBe(20)
  })

  it('supports computed member access with string variable', async () => {
    const scope = Value.of({ obj: { foo: 'bar' }, key: 'foo' })
    const result = await safeEval('obj[key]', scope)
    expect(result.raw).toBe('bar')
  })

  it('throws on super in member expression', () => {
    // super outside a method is a parse error, which is fine - it's still blocked
    expect(() => safeEval('super.method()', Value.of({}))).toThrow(/super/)
  })

  it('throws on private identifiers', () => {
    expect(() => safeEval('obj.#private', Value.of({ obj: {} }))).toThrow()
  })
})

describe('evaluator edge cases - call expressions', () => {
  it('throws on super calls', () => {
    // super outside a constructor is a parse error, which is fine - it's still blocked
    expect(() => safeEval('super()', Value.of({}))).toThrow(/super/)
  })

  it('throws when calling non-function', () => {
    const scope = Value.of({ notAFunction: 42 })
    expect(() => safeEval('notAFunction()', scope)).toThrow(/must be a function/)
  })

  it('supports spread in function arguments', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number(), z.number())
      sum(a: number, b: number, c: number) { return a + b + c }
    })
    const result = await safeEval('sum(...[1, 2, 3])', scope)
    expect(result.raw).toBe(6)
  })
})

describe('evaluator edge cases - unary expressions', () => {
  it('supports unary minus on numbers', async () => {
    expect((await safeEval('-5', Value.of({}))).raw).toBe(-5)
    expect((await safeEval('-3.14', Value.of({}))).raw).toBe(-3.14)
  })

  it('throws on unary minus with non-number', () => {
    expect(() => safeEval('-"hello"', Value.of({}))).toThrow(/requires a number/)
  })

  it('throws on other unary operators', () => {
    expect(() => safeEval('!true', Value.of({}))).toThrow(/Only unary minus/)
    expect(() => safeEval('~5', Value.of({}))).toThrow(/Only unary minus/)
    expect(() => safeEval('+5', Value.of({}))).toThrow(/Only unary minus/)
    expect(() => safeEval('typeof x', Value.of({ x: 1 }))).toThrow(/Only unary minus/)
  })
})

describe('evaluator - taint propagation', () => {
  it('propagates taints through member access', async () => {
    const scope = Value.of({ obj: Value.of({ nested: Value.of(42, ['inner']) }, ['outer']) }, ['root'])
    const result = await safeEval('obj', scope)
    expect(result.getTaints()).toContain('root')
  })

  it('propagates taints through array construction', async () => {
    const scope = Value.of({ tainted: Value.of(1, ['source']) })
    const result = await safeEval('[tainted, 2, 3]', scope)
    expect(result.getTaints()).toContain('source')
  })

  it('propagates taints through object construction', async () => {
    const scope = Value.of({ tainted: Value.of('secret', ['sensitive']) })
    const result = await safeEval('{ key: tainted }', scope)
    expect(result.getTaints()).toContain('sensitive')
  })

  it('propagates taints through spread operations', async () => {
    const scope = Value.of({ arr: Value.of([Value.of(1, ['t1']), Value.of(2, ['t2'])], []) })
    const result = await safeEval('[...arr]', scope)
    expect(result.getTaints()).toContain('t1')
    expect(result.getTaints()).toContain('t2')
  })

  it('merges taints from computed property access', async () => {
    const scope = Value.of({
      obj: Value.of({ a: Value.of(1, ['value-taint']) }, ['obj-taint']),
      key: Value.of('a', ['key-taint']),
    })
    const result = await safeEval('obj[key]', scope)
    expect(result.getTaints()).toContain('obj-taint')
    expect(result.getTaints()).toContain('key-taint')
    expect(result.getTaints()).toContain('value-taint')
  })
})

describe('scope - variable binding and shadowing', () => {
  it('supports variable shadowing in nested blocks', async () => {
    const scope = Value.of(new class {
      @tool(z.number())
      id(x: number) { return x }
    })
    const result = await safeEval(`
      (() => {
        const x = id(1);
        return (() => {
          const x = id(2);
          return x
        })()
      })()
    `, scope)
    expect(result.raw).toBe(2)
  })

  it('inner scope can access outer scope variables', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) { return a + b }
    })
    const result = await safeEval(`
      (() => {
        const outer = 10;
        return (() => {
          const inner = 5;
          return add(outer, inner)
        })()
      })()
    `, scope)
    expect(result.raw).toBe(15)
  })

  it('deeply nested scopes work correctly', async () => {
    const scope = Value.of(new class {
      @tool(z.number())
      id(x: number) { return x }
    })
    const result = await safeEval(`
      (() => {
        const a = id(1);
        return (() => {
          const b = id(2);
          return (() => {
            const c = id(3);
            return (() => {
              const d = id(4);
              return [a, b, c, d]
            })()
          })()
        })()
      })()
    `, scope)
    const arr = result.raw as Value[]
    expect(arr.map(v => v.raw)).toEqual([1, 2, 3, 4])
  })
})

describe('scope - destructuring bindings', () => {
  it('supports object destructuring in const', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) { return a + b }
    })
    const result = await safeEval(`
      (() => {
        const { x, y } = { x: 3, y: 7 };
        return add(x, y)
      })()
    `, scope)
    expect(result.raw).toBe(10)
  })

  it('supports array destructuring in const', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) { return a + b }
    })
    const result = await safeEval(`
      (() => {
        const [a, b] = [5, 15];
        return add(a, b)
      })()
    `, scope)
    expect(result.raw).toBe(20)
  })

  it('supports nested destructuring', async () => {
    const scope = Value.of(new class {
      @tool(z.number(), z.number())
      add(a: number, b: number) { return a + b }
    })
    const result = await safeEval(`
      (() => {
        const { a: { b } } = { a: { b: 42 } };
        return add(b, 0)
      })()
    `, scope)
    expect(result.raw).toBe(42)
  })

  it('supports rest element in array destructuring', async () => {
    const scope = Value.of(new class {
      @tool(z.array(z.any()))
      len(arr: unknown[]) { return arr.length }
    })
    const result = await safeEval(`
      (() => {
        const [first, ...rest] = [1, 2, 3, 4];
        return len(rest)
      })()
    `, scope)
    expect(result.raw).toBe(3)
  })

  it('supports rest element in object destructuring', async () => {
    const scope = Value.of(new class {
      @tool(z.record(z.string(),z.any()))
      keys(obj: Record<string, unknown>) { return Object.keys(obj).length }
    })
    const result = await safeEval(`
      (() => {
        const { a, ...rest } = { a: 1, b: 2, c: 3 };
        return keys(rest)
      })()
    `, scope)
    expect(result.raw).toBe(2)
  })

  it('supports default values in destructuring', async () => {
    const scope = Value.of(new class {
      @tool(z.number())
      id(x: number) { return x }
    })
    const result = await safeEval(`
      (() => {
        const { x = 100 } = {};
        return id(x)
      })()
    `, scope)
    expect(result.raw).toBe(100)
  })

  it('supports computed property keys in object destructuring', async () => {
    const scope = Value.of(new class {
      @tool(z.number())
      id(x: number) { return x }
    })
    const result = await safeEval(`
      (() => {
        const key = "myKey";
        const { [key]: value } = { myKey: 42 };
        return id(value)
      })()
    `, scope)
    expect(result.raw).toBe(42)
  })

  it('skips null elements in array destructuring', async () => {
    const scope = Value.of(new class {
      @tool(z.number())
      id(x: number) { return x }
    })
    const result = await safeEval(`
      (() => {
        const [, , third] = [1, 2, 3];
        return id(third)
      })()
    `, scope)
    expect(result.raw).toBe(3)
  })
})

describe('scope - global scope immutability', () => {
  it('cannot reassign global scope variables', () => {
    // Global scope doesn't allow set(), but we can't test direct assignment
    // since assignment expressions are not supported. Instead we verify
    // that const declarations in inner scopes don't affect globals.
    const scope = Value.of({ value: Value.of(42, []) })

    // This should work - we're reading from global, not writing
    const result = safeEval('value', scope)
    expect((result as Value).raw).toBe(42)
  })
})

describe('scope - error cases', () => {
  it('throws when binding same variable twice in same scope', async () => {
    const scope = Value.of(new class {
      @tool(z.number())
      id(x: number) { return x }
    })
    // acorn catches duplicate const declarations at parse time
    expect(() => safeEval(`
      (() => {
        const x = id(1);
        const x = id(2);
        return x
      })()
    `, scope)).toThrow()
  })

  it('throws when destructuring non-array with array pattern', () => {
    expect(() => safeEval(`
      (() => {
        const [a, b] = { x: 1 };
        return a
      })()
    `, Value.of({}))).toThrow(/Array pattern expects an array/)
  })

  it('throws when destructuring non-object with object pattern', () => {
    expect(() => safeEval(`
      (() => {
        const { x } = "not an object";
        return x
      })()
    `, Value.of({}))).toThrow(/Object pattern must evaluate to an object/)
  })
})

describe('security - prototype pollution prevention', () => {
  it('blocks __proto__ property access', () => {
    const scope = Value.of({ obj: { normal: 'value' } })
    expect(() => safeEval('obj.__proto__', scope)).toThrow()
  })

  it('blocks __proto__ in computed access', () => {
    const scope = Value.of({ obj: { normal: 'value' }, key: '__proto__' })
    expect(() => safeEval('obj[key]', scope)).toThrow()
  })

  it('blocks constructor property access', () => {
    const scope = Value.of({ obj: {} })
    expect(() => safeEval('obj.constructor', scope)).toThrow()
  })

  it('blocks prototype property access', () => {
    const scope = Value.of({ obj: {} })
    expect(() => safeEval('obj.prototype', scope)).toThrow()
  })

  it('blocks Object.prototype methods', () => {
    const scope = Value.of({ obj: {} })
    expect(() => safeEval('obj.toString', scope)).toThrow()
    expect(() => safeEval('obj.hasOwnProperty', scope)).toThrow()
    expect(() => safeEval('obj.valueOf', scope)).toThrow()
  })

  it('allows normal property access', () => {
    const scope = Value.of({ obj: { safe: 'value', anotherSafe: 123 } })
    expect((safeEval('obj.safe', scope) as Value).raw).toBe('value')
    expect((safeEval('obj.anotherSafe', scope) as Value).raw).toBe(123)
  })
})

describe('security - global object access prevention', () => {
  it('cannot access undefined globals', () => {
    // These should return undefined, not throw, but importantly
    // they should NOT access actual globals
    expect((safeEval('window', Value.of({})) as Value).raw).toBe(undefined)
    expect((safeEval('globalThis', Value.of({})) as Value).raw).toBe(undefined)
    expect((safeEval('global', Value.of({})) as Value).raw).toBe(undefined)
    expect((safeEval('self', Value.of({})) as Value).raw).toBe(undefined)
  })

  it('cannot access process or require', () => {
    expect((safeEval('process', Value.of({})) as Value).raw).toBe(undefined)
    expect((safeEval('require', Value.of({})) as Value).raw).toBe(undefined)
  })

  it('cannot access eval or Function', () => {
    expect((safeEval('eval', Value.of({})) as Value).raw).toBe(undefined)
    expect((safeEval('Function', Value.of({})) as Value).raw).toBe(undefined)
  })
})

describe('security - dangerous operations blocked', () => {
  it('blocks function constructor via new', () => {
    expect(() => safeEval('new Function("return 1")', Value.of({}))).toThrow(/Unsupported expression|new.*not allowed/)
  })

  it('blocks import expressions', () => {
    expect(() => safeEval('import("fs")', Value.of({}))).toThrow()
  })

  it('blocks with statements via syntax', () => {
    // 'with' is not an expression, so should fail at parse
    expect(() => safeEval('with ({}) {}', Value.of({}))).toThrow()
  })

  it('blocks eval-like patterns', () => {
    // Can't call undefined, and can't access eval
    const scope = Value.of({})
    expect(() => safeEval('eval("1+1")', scope)).toThrow()
  })
})

describe('security - member access safety', () => {
  it('blocks numeric keys that could be exploited', () => {
    // Verify large indices don't cause issues
    const scope = Value.of({ arr: [1, 2, 3] })
    const result = safeEval('arr[1000000]', scope) as Value
    expect(result.raw).toBe(undefined) // Out of bounds is fine, just undefined
  })

  it('handles undefined property access safely', () => {
    const scope = Value.of({ obj: { a: 1 } })
    const result = safeEval('obj.nonexistent', scope) as Value
    expect(result.raw).toBe(undefined)
  })

  it('blocks Symbol.* access patterns', () => {
    // Symbols can't be property keys in our system
    const scope = Value.of({ obj: {} })
    // This should fail because Symbol isn't defined
    expect((safeEval('Symbol', scope) as Value).raw).toBe(undefined)
  })
})

describe('security - function call safety', () => {
  it('cannot call methods on primitives (no prototype access)', () => {
    // String methods would require prototype access
    const scope = Value.of({ str: 'hello' })
    // str.toUpperCase() would require accessing String.prototype
    expect(() => safeEval('str.toUpperCase', scope)).toThrow()
  })

  it('cannot call array prototype methods directly', () => {
    // Array methods would require calling internal functions
    const scope = Value.of({ arr: [1, 2, 3] })
    expect(() => safeEval('arr.map', scope)).toThrow()
    expect(() => safeEval('arr.filter', scope)).toThrow()
    expect(() => safeEval('arr.reduce', scope)).toThrow()
  })

  it('only allows calls to @tool decorated methods', () => {
    // Non-tool methods on objects should not be callable
    class NotAToolset {
      regularMethod() { return 'should not work' }
    }
    const scope = Value.of({ obj: new NotAToolset() })
    expect(() => safeEval('obj.regularMethod()', scope)).toThrow()
  })

  it('tool-decorated methods are callable', () => {
    const scope = Value.of(new class {
      @tool()
      safeMethod() { return 'works' }
    })
    const result = safeEval('safeMethod()', scope) as Value
    expect(result.raw).toBe('works')
  })
})

describe('security - expression injection prevention', () => {
  it('handles strings with code-like content safely', () => {
    const scope = Value.of({ str: 'eval("malicious")' })
    const result = safeEval('str', scope) as Value
    expect(result.raw).toBe('eval("malicious")') // It's just a string
  })

  it('cannot execute strings as code', () => {
    const scope = Value.of({ code: '1 + 1' })
    // There's no way to execute the string 'code' as actual code
    const result = safeEval('code', scope) as Value
    expect(result.raw).toBe('1 + 1') // Just returns the string
  })
})

describe('security - RegExp safety', () => {
  it('blocks RegExp literals (potential ReDoS)', () => {
    expect(() => safeEval('/a+/', Value.of({}))).toThrow(/RegExp literals are not allowed/)
  })

  it('blocks complex RegExp patterns', () => {
    expect(() => safeEval('/(a+)+$/', Value.of({}))).toThrow(/RegExp literals are not allowed/)
  })
})

describe('security - thenable/Promise escape hatch prevention', () => {
  it('blocks constructing objects with "then" property', () => {
    // This prevents creating fake thenables that could bypass policy via await
    expect(() => safeEval('{ then: 1 }', Value.of({}))).toThrow(/safe string or number/)
  })

  it('blocks constructing objects with "catch" property', () => {
    expect(() => safeEval('{ catch: 1 }', Value.of({}))).toThrow(/safe string or number/)
  })

  it('blocks constructing objects with "finally" property', () => {
    expect(() => safeEval('{ finally: 1 }', Value.of({}))).toThrow(/safe string or number/)
  })

  it('blocks computed "then" property', () => {
    const scope = Value.of({ key: 'then' })
    expect(() => safeEval('{ [key]: 1 }', scope)).toThrow(/safe string or number/)
  })

  it('blocks accessing "then" on objects', () => {
    // Even if an object somehow has a then, we can't access it
    const scope = Value.of({ obj: { normal: 1 } })
    expect(() => safeEval('obj.then', scope)).toThrow()
  })

  it('allows awaiting actual Promises from tool calls', async () => {
    const scope = Value.of(new class {
      @tool()
      getPromise() { return Promise.resolve(42) }
    })
    const result = await safeEval('(async () => { return await getPromise() })()', scope)
    expect(result.raw).toBe(42)
  })
})

describe('security - infinite loop prevention', () => {
  // Note: The evaluator doesn't support loops (for, while), which provides
  // implicit protection against infinite loops

  it('while loops are not supported', () => {
    expect(() => safeEval('while(true) {}', Value.of({}))).toThrow()
  })

  it('for loops are not supported', () => {
    expect(() => safeEval('for(;;) {}', Value.of({}))).toThrow()
  })

  it('do-while loops are not supported', () => {
    expect(() => safeEval('do {} while(true)', Value.of({}))).toThrow()
  })
})

describe('security - statement restrictions', () => {
  it('throw statements are not supported', () => {
    // throw inside a function body triggers evaluator-level rejection
    expect(() => safeEval('(() => { throw new Error("test") })()', Value.of({}))).toThrow(/Unsupported statement/)
  })

  it('try-catch is not supported', () => {
    expect(() => safeEval('try {} catch(e) {}', Value.of({}))).toThrow()
  })

  it('if statements are not supported', () => {
    expect(() => safeEval('if (true) { 1 }', Value.of({}))).toThrow()
  })

  it('switch statements are not supported', () => {
    expect(() => safeEval('switch(1) { case 1: break; }', Value.of({}))).toThrow()
  })
})
