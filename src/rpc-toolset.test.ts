import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RpcToolset, tool } from './rpc-toolset'
import { TestToolset, User } from './rpc-toolset-test-helpers'
import { isFromItem } from './sql/builder'
import { compiledQuery } from './sql/test-helpers'

describe('tool decorator', () => {
  it('validates input when schema is provided', () => {
    class TestToolset extends RpcToolset {
      @tool(z.object({
        name: z.string(),
        age: z.number(),
      }))
      greet(input: { name: string, age: number }) {
        return `Hello, ${input.name}! You are ${input.age} years old.`
      }
    }

    const toolset = new TestToolset()
    expect(toolset.greet({ name: 'Alice', age: 30 })).toBe('Hello, Alice! You are 30 years old.')
  })

  it('throws error when input does not match schema', () => {
    class TestToolset extends RpcToolset {
      @tool(z.object({
        name: z.string(),
        age: z.number(),
      }))
      greet(input: { name: string, age: number }) {
        return `Hello, ${input.name}!`
      }
    }

    const toolset = new TestToolset()
    expect(() => toolset.greet({ name: 'Alice', age: '30' as any })).toThrow('Invalid value')
  })

  it('allows no arguments when no schema is provided', () => {
    class TestToolset extends RpcToolset {
      @tool()
      getCount() {
        return 42
      }
    }

    const toolset = new TestToolset()
    expect(toolset.getCount()).toBe(42)
  })

  it('throws error when argument provided but no schema', () => {
    class TestToolset extends RpcToolset {
      @tool()
      getCount() {
        return 42
      }
    }

    const toolset = new TestToolset()
    expect(() => (toolset as any).getCount({ some: 'arg' })).toThrow('Tool getCount got too many arguments: 1 provided (expected 0)')
  })

  it('throws error when multiple arguments provided', () => {
    class TestToolset extends RpcToolset {
      @tool(z.object({
        name: z.string(),
      }))
      greet(input: { name: string }) {
        return `Hello, ${input.name}!`
      }
    }

    const toolset = new TestToolset()
    expect(() => (toolset as any).greet({ name: 'Alice' }, { extra: 'arg' })).toThrow('Tool greet got too many arguments: 2 provided (expected 1)')
  })

  it('correctly types the method argument based on schema', () => {
    class Calculator extends RpcToolset {
      @tool(z.object({
        x: z.number(),
        y: z.number(),
      }))
      add(input: { x: number, y: number }) {
        return input.x + input.y
      }
    }

    const calc = new Calculator()
    const result = calc.add({ x: 5, y: 3 })
    expect(result).toBe(8)
    // TypeScript should infer the correct type for input
    expect(typeof result).toBe('number')
  })

  it('works with async methods', async () => {
    class AsyncToolset extends RpcToolset {
      @tool(z.object({
        delay: z.number(),
      }))
      async wait(input: { delay: number }) {
        await new Promise(resolve => setTimeout(resolve, input.delay))
        return `Waited ${input.delay}ms`
      }
    }

    const toolset = new AsyncToolset()
    const result = await toolset.wait({ delay: 10 })
    expect(result).toBe('Waited 10ms')
  })

  it('works with optional schema fields', () => {
    class TestToolset extends RpcToolset {
      @tool(z.object({
        required: z.string(),
        optional: z.string().optional(),
      }))
      process(input: { required: string, optional?: string }) {
        return input.optional ?? 'default'
      }
    }

    const toolset = new TestToolset()
    expect(toolset.process({ required: 'test' })).toBe('default')
    expect(toolset.process({ required: 'test', optional: 'value' })).toBe('value')
  })

  it('should cause TypeScript error when schema type does not match method argument signature', () => {
    class TestToolset extends RpcToolset {
      // @ts-expect-error - age is specified as a number but we're passing a string
      @tool(z.object({
        name: z.string(),
        age: z.number(),
      }))
      greet(input: { name: string, age: string }) {
        return `Hello, ${input.name}!`
      }
    }

    // This test verifies that TypeScript will error if types don't match
    // Note: Type checking happens at compile time, so this test mainly verifies runtime behavior
    const toolset = new TestToolset()
    // @ts-expect-error - age should be number but we're passing 30 (number) to a method expecting string
    expect(toolset.greet({ name: 'Alice', age: 30 })).toBe('Hello, Alice!')
  })

  it('throws error when toolset method is not a tool', () => {
    class TestToolset extends RpcToolset {
      notATool() {
        return 'not a tool'
      }
    }

    expect(() => new TestToolset()).toThrow('Prototype method notATool is not a tool. Did you forget to use the @tool decorator?')
  })
})

describe('sql integration with RPC toolset', () => {
  it('can call table method decorated with @tool() and use returned table in join', () => {
    const user = new User()
    const postsTable = user.posts()

    expect(isFromItem(postsTable)).toBe(true)
    expect(postsTable.tableName).toBe('posts')

    // Verify the table can be used in a join
    const query = User.from()
      .join(({ user }) => user.posts())
      .select(({ user, post }) => ({ userName: user.name, postTitle: post.title }))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."name" as "userName", "post"."title" as "postTitle" FROM "users" AS "user" JOIN "posts" AS "post" ON "post"."user_id" = "user"."id"',
      parameters: [],
    })
  })

  it('can return table with on expression from toolset method and use in query', async () => {
    const toolset = new TestToolset()
    const userTable = await toolset.userForId({ id: '123' })

    expect(isFromItem(userTable)).toBe(true)
    expect(userTable.tableName).toBe('users')

    // Verify the table can be used in a query with the on expression applied as a where clause
    const query = userTable.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" WHERE "user"."id" = $1',
      parameters: ['123'],
    })
  })
})
