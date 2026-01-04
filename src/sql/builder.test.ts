import { describe, expect, it } from 'vitest'
import { table } from './builder'
import { compiledQuery } from './test-helpers'

describe('sql query builder', () => {
  it('creates a simple select query', () => {
    const users = table('users', ['id', 'name', 'email'])

    const query = users.select(({ users }) => ({ id: users.id, name: users.name }))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users"',
      parameters: [],
    })
  })

  it('creates a query with where clause', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({
        id: users.id,
        name: users.name,
      }))
      .where(({ users }) => users.id)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" WHERE "users"."id"',
      parameters: [],
    })
  })

  it('chains where clauses with AND', () => {
    const users = table('users', ['id', 'name', 'email', 'age'] as const)

    const query = users
      .select(({ users }) => ({
        id: users.id,
        name: users.name,
      }))
      .where(({ users }) => users.id['='](users.id))
      .where(({ users }) => users.name['='](users.name))
      .where(({ users }) => users.age['>'](users.age))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" WHERE "users"."id" = "users"."id" AND "users"."name" = "users"."name" AND "users"."age" > "users"."age"',
      parameters: [],
    })
  })

  it('creates a query with joins', () => {
    const users = table('users', ['id', 'name', 'email'])
    const posts = table('posts', ['id', 'user_id', 'title', 'content'])

    const query = users
      .join(posts, ({ users, posts }) => users.id['='](posts.user_id))
      .select(({ users, posts }) => ({
        userName: users.name,
        postTitle: posts.title,
      }))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."name" as "userName", "posts"."title" as "postTitle" FROM "users" AS "users" JOIN "posts" AS "posts" ON "users"."id" = "posts"."user_id"',
      parameters: [],
    })
  })

  it('handles operator precedence correctly', () => {
    const users = table('users', ['id', 'name', 'age', 'score'])

    // AND has higher precedence than OR, so OR should be parenthesized
    const query1 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.id['='](users.id).and(users.name['='](users.name)).or(users.age['>'](users.age)))

    expect(compiledQuery(query1.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE "users"."id" = "users"."id" AND "users"."name" = "users"."name" OR "users"."age" > "users"."age"',
      parameters: [],
    })

    // When OR is on the left of AND, it should be parenthesized
    const query2 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.id['='](users.id).or(users.name['='](users.name)).and(users.age['>'](users.age)))

    expect(compiledQuery(query2.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE ("users"."id" = "users"."id" OR "users"."name" = "users"."name") AND "users"."age" > "users"."age"',
      parameters: [],
    })

    // Multiplication has higher precedence than addition
    const query3 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.score['+'](users.score)['*'](users.score)['='](users.score))

    expect(compiledQuery(query3.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE ("users"."score" + "users"."score") * "users"."score" = "users"."score"',
      parameters: [],
    })

    // Comparison operators have higher precedence than AND/OR
    const query4 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.id['>'](users.age).and(users.score['<'](users.score)))

    expect(compiledQuery(query4.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE "users"."id" > "users"."age" AND "users"."score" < "users"."score"',
      parameters: [],
    })

    // Unary NOT has higher precedence than AND
    const query5 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.id.not().and(users.name['='](users.name)))

    expect(compiledQuery(query5.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE NOT "users"."id" AND "users"."name" = "users"."name"',
      parameters: [],
    })
  })

  it('handles nested parentheses correctly', () => {
    const users = table('users', ['id', 'name', 'age', 'score', 'active'])

    // Nested OR inside AND: (A AND (B OR C))
    const query1 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.id['='](users.id).and(users.name['='](users.name).or(users.age['>'](users.age))))

    expect(compiledQuery(query1.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE "users"."id" = "users"."id" AND ("users"."name" = "users"."name" OR "users"."age" > "users"."age")',
      parameters: [],
    })

    // Multiple levels: (A OR B) AND C OR D (AND has higher precedence, so SQL parses as ((A OR B) AND C) OR D)
    const query2 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.id['='](users.id).or(users.name['='](users.name)).and(users.age['>'](users.age)).or(users.score['<'](users.score)))

    expect(compiledQuery(query2.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE ("users"."id" = "users"."id" OR "users"."name" = "users"."name") AND "users"."age" > "users"."age" OR "users"."score" < "users"."score"',
      parameters: [],
    })

    // Nested arithmetic: (A + B) * (C + D)
    const query3 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.score['+'](users.score)['*'](users.score['+'](users.score))['='](users.score))

    expect(compiledQuery(query3.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE ("users"."score" + "users"."score") * ("users"."score" + "users"."score") = "users"."score"',
      parameters: [],
    })

    // Deep nesting: A AND (B OR C AND D) (AND has higher precedence, so SQL parses as A AND (B OR (C AND D)))
    const query4 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.id['='](users.id).and(users.name['='](users.name).or(users.age['>'](users.age).and(users.score['<'](users.score)))))

    expect(compiledQuery(query4.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE "users"."id" = "users"."id" AND ("users"."name" = "users"."name" OR "users"."age" > "users"."age" AND "users"."score" < "users"."score")',
      parameters: [],
    })

    // Nested unary: NOT (A AND B)
    const query5 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.id['='](users.id).and(users.name['='](users.name)).not())

    expect(compiledQuery(query5.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE NOT ("users"."id" = "users"."id" AND "users"."name" = "users"."name")',
      parameters: [],
    })

    // Complex nested expression with mixed operators: (A OR B) AND (C OR D) OR E (AND has higher precedence)
    const query6 = users
      .select(({ users }) => ({ id: users.id }))
      .where(({ users }) => users.id['='](users.id).or(users.name['='](users.name)).and(users.age['>'](users.age).or(users.score['<'](users.score))).or(users.active['='](users.active)))

    expect(compiledQuery(query6.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id" FROM "users" AS "users" WHERE ("users"."id" = "users"."id" OR "users"."name" = "users"."name") AND ("users"."age" > "users"."age" OR "users"."score" < "users"."score") OR "users"."active" = "users"."active"',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - single expression', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .orderBy(({ users }) => users.id)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" ORDER BY "users"."id"',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - single expression with desc()', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .orderBy(({ users }) => users.id.desc())

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" ORDER BY "users"."id" DESC',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - array of expressions', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .orderBy(({ users }) => [users.id, users.name])

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" ORDER BY "users"."id", "users"."name"',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - array with desc()', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .orderBy(({ users }) => [users.id.desc(), users.name])

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" ORDER BY "users"."id" DESC, "users"."name"',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - chained orderBy calls', () => {
    const users = table('users', ['id', 'name', 'email', 'age'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .orderBy(({ users }) => users.id.asc())
      .orderBy(({ users }) => users.name.desc())

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" ORDER BY "users"."id" ASC, "users"."name" DESC',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - array with multiple desc()', () => {
    const users = table('users', ['id', 'name', 'email', 'age'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .orderBy(({ users }) => [users.id.desc(), users.name.desc(), users.age])

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" ORDER BY "users"."id" DESC, "users"."name" DESC, "users"."age"',
      parameters: [],
    })
  })

  it('creates a query with limit', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .limit(10)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" LIMIT $1',
      parameters: [10],
    })
  })

  it('creates a query with offset', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .offset(5)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" OFFSET $1',
      parameters: [5],
    })
  })

  it('creates a query with limit and offset', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .limit(10)
      .offset(5)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" LIMIT $1 OFFSET $2',
      parameters: [10, 5],
    })
  })

  it('creates a query with orderBy, limit, and offset', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .orderBy(({ users }) => users.id.desc())
      .limit(10)
      .offset(5)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" ORDER BY "users"."id" DESC LIMIT $1 OFFSET $2',
      parameters: [10, 5],
    })
  })

  it('creates a query with where, orderBy, limit, and offset', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .where(({ users }) => users.id['='](users.id))
      .orderBy(({ users }) => users.id.desc())
      .limit(10)
      .offset(5)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" WHERE "users"."id" = "users"."id" ORDER BY "users"."id" DESC LIMIT $1 OFFSET $2',
      parameters: [10, 5],
    })
  })

  it('limit attenuates - subsequent limit calls use minimum', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .limit(20)
      .limit(10)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" LIMIT $1',
      parameters: [10],
    })
  })

  it('limit attenuates - subsequent limit calls do not increase limit', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .limit(10)
      .limit(20)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" LIMIT $1',
      parameters: [10],
    })
  })

  it('offset accumulates - subsequent offset calls add together', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .offset(5)
      .offset(10)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" OFFSET $1',
      parameters: [15],
    })
  })

  it('offset accumulates with multiple calls', () => {
    const users = table('users', ['id', 'name', 'email'] as const)

    const query = users
      .select(({ users }) => ({ id: users.id, name: users.name }))
      .offset(5)
      .offset(10)
      .offset(3)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."id" as "id", "users"."name" as "name" FROM "users" AS "users" OFFSET $1',
      parameters: [18],
    })
  })

  it('creates a query with joins, where, orderBy, limit, and offset', () => {
    const users = table('users', ['id', 'name', 'email'])
    const posts = table('posts', ['id', 'user_id', 'title', 'content'])

    const query = users
      .join(posts, ({ users, posts }) => users.id['='](posts.user_id))
      .select(({ users, posts }) => ({
        userName: users.name,
        postTitle: posts.title,
      }))
      .where(({ users }) => users.id['='](users.id))
      .orderBy(({ users }) => users.id.desc())
      .limit(10)
      .offset(5)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "users"."name" as "userName", "posts"."title" as "postTitle" FROM "users" AS "users" JOIN "posts" AS "posts" ON "users"."id" = "posts"."user_id" WHERE "users"."id" = "users"."id" ORDER BY "users"."id" DESC LIMIT $1 OFFSET $2',
      parameters: [10, 5],
    })
  })
})
