import { describe, expect, it } from 'vitest'
import { tool } from '../rpc-toolset'
import { Database } from './builder'
import { LiteralExpression } from './expression'
import { compiledQuery, dummyDialect } from './test-helpers'

const db = new Database(dummyDialect)

class User extends db.Table('users').as('user') {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')
  age = this.column('age')
  score = this.column('score')
  active = this.column('active')
  managerId = this.column('manager_id')

  @tool()
  posts() {
    return Post.on(post => post.userId['='](this.id))
  }
}

class Post extends db.Table('posts').as('post') {
  id = this.column('id')
  userId = this.column('user_id')
  title = this.column('title')
  content = this.column('content')
}

describe('sql query builder', () => {
  it('creates a simple select query', () => {
    const query = User.from().select(({ user }) => ({ id: user.id, name: user.name }))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user"',
      parameters: [],
    })
  })

  it('creates a query with where clause', () => {
    const query = User.from()
      .select(({ user }) => ({
        id: user.id,
        name: user.name,
      }))
      .where(({ user }) => user.id)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" WHERE "user"."id"',
      parameters: [],
    })
  })

  it('chains where clauses with AND', () => {
    const query = User.from()
      .select(({ user }) => ({
        id: user.id,
        name: user.name,
      }))
      .where(({ user }) => user.id['='](user.id))
      .where(({ user }) => user.name['='](user.name))
      .where(({ user }) => user.age['>'](user.age))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" WHERE "user"."id" = "user"."id" AND "user"."name" = "user"."name" AND "user"."age" > "user"."age"',
      parameters: [],
    })
  })

  it('creates a query with joins', () => {
    const query = User.from()
      .join(Post.from().select(({ post }) => post), ({ user, post }) => user.id['='](post.userId))
      .select(({ user, post }) => ({
        userName: user.name,
        postTitle: post.title,
      }))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."name" as "userName", "post"."title" as "postTitle" FROM "users" AS "user" JOIN (SELECT "post"."id" as "id", "post"."user_id" as "userId", "post"."title" as "title", "post"."content" as "content" FROM "posts" AS "post") AS "post" ON "user"."id" = "post"."userId"',
      parameters: [],
    })
  })

  it('handles operator precedence correctly', () => {
    // AND has higher precedence than OR, so OR should be parenthesized
    const query1 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.id['='](user.id).and(user.name['='](user.name)).or(user.age['>'](user.age)))

    expect(compiledQuery(query1.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE "user"."id" = "user"."id" AND "user"."name" = "user"."name" OR "user"."age" > "user"."age"',
      parameters: [],
    })

    // When OR is on the left of AND, it should be parenthesized
    const query2 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.id['='](user.id).or(user.name['='](user.name)).and(user.age['>'](user.age)))

    expect(compiledQuery(query2.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE ("user"."id" = "user"."id" OR "user"."name" = "user"."name") AND "user"."age" > "user"."age"',
      parameters: [],
    })

    // Multiplication has higher precedence than addition
    const query3 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.score['+'](user.score)['*'](user.score)['='](user.score))

    expect(compiledQuery(query3.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE ("user"."score" + "user"."score") * "user"."score" = "user"."score"',
      parameters: [],
    })

    // Comparison operators have higher precedence than AND/OR
    const query4 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.id['>'](user.age).and(user.score['<'](user.score)))

    expect(compiledQuery(query4.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE "user"."id" > "user"."age" AND "user"."score" < "user"."score"',
      parameters: [],
    })

    // Unary NOT has higher precedence than AND
    const query5 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.id.not().and(user.name['='](user.name)))

    expect(compiledQuery(query5.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE NOT "user"."id" AND "user"."name" = "user"."name"',
      parameters: [],
    })
  })

  it('handles nested parentheses correctly', () => {
    // Nested OR inside AND: (A AND (B OR C))
    const query1 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.id['='](user.id).and(user.name['='](user.name).or(user.age['>'](user.age))))

    expect(compiledQuery(query1.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE "user"."id" = "user"."id" AND ("user"."name" = "user"."name" OR "user"."age" > "user"."age")',
      parameters: [],
    })

    // Multiple levels: (A OR B) AND C OR D (AND has higher precedence, so SQL parses as ((A OR B) AND C) OR D)
    const query2 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.id['='](user.id).or(user.name['='](user.name)).and(user.age['>'](user.age)).or(user.score['<'](user.score)))

    expect(compiledQuery(query2.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE ("user"."id" = "user"."id" OR "user"."name" = "user"."name") AND "user"."age" > "user"."age" OR "user"."score" < "user"."score"',
      parameters: [],
    })

    // Nested arithmetic: (A + B) * (C + D)
    const query3 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.score['+'](user.score)['*'](user.score['+'](user.score))['='](user.score))

    expect(compiledQuery(query3.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE ("user"."score" + "user"."score") * ("user"."score" + "user"."score") = "user"."score"',
      parameters: [],
    })

    // Deep nesting: A AND (B OR C AND D) (AND has higher precedence, so SQL parses as A AND (B OR (C AND D)))
    const query4 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.id['='](user.id).and(user.name['='](user.name).or(user.age['>'](user.age).and(user.score['<'](user.score)))))

    expect(compiledQuery(query4.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE "user"."id" = "user"."id" AND ("user"."name" = "user"."name" OR "user"."age" > "user"."age" AND "user"."score" < "user"."score")',
      parameters: [],
    })

    // Nested unary: NOT (A AND B)
    const query5 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.id['='](user.id).and(user.name['='](user.name)).not())

    expect(compiledQuery(query5.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE NOT ("user"."id" = "user"."id" AND "user"."name" = "user"."name")',
      parameters: [],
    })

    // Complex nested expression with mixed operators: (A OR B) AND (C OR D) OR E (AND has higher precedence)
    const query6 = User.from()
      .select(({ user }) => ({ id: user.id }))
      .where(({ user }) => user.id['='](user.id).or(user.name['='](user.name)).and(user.age['>'](user.age).or(user.score['<'](user.score))).or(user.active['='](user.active)))

    expect(compiledQuery(query6.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id" FROM "users" AS "user" WHERE ("user"."id" = "user"."id" OR "user"."name" = "user"."name") AND ("user"."age" > "user"."age" OR "user"."score" < "user"."score") OR "user"."active" = "user"."active"',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - single expression', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .orderBy(({ user }) => user.id)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" ORDER BY "user"."id"',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - single expression with desc()', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .orderBy(({ user }) => user.id.desc())

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" ORDER BY "user"."id" DESC',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - array of expressions', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .orderBy(({ user }) => [user.id, user.name])

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" ORDER BY "user"."id", "user"."name"',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - array with desc()', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .orderBy(({ user }) => [user.id.desc(), user.name])

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" ORDER BY "user"."id" DESC, "user"."name"',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - chained orderBy calls', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .orderBy(({ user }) => user.id.asc())
      .orderBy(({ user }) => user.name.desc())

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" ORDER BY "user"."id" ASC, "user"."name" DESC',
      parameters: [],
    })
  })

  it('creates a query with orderBy clause - array with multiple desc()', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .orderBy(({ user }) => [user.id.desc(), user.name.desc(), user.age])

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" ORDER BY "user"."id" DESC, "user"."name" DESC, "user"."age"',
      parameters: [],
    })
  })

  it('creates a query with limit', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .limit(10)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" LIMIT $1',
      parameters: [10],
    })
  })

  it('creates a query with offset', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .offset(5)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" OFFSET $1',
      parameters: [5],
    })
  })

  it('creates a query with limit and offset', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .limit(10)
      .offset(5)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" LIMIT $1 OFFSET $2',
      parameters: [10, 5],
    })
  })

  it('creates a query with orderBy, limit, and offset', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .orderBy(({ user }) => user.id.desc())
      .limit(10)
      .offset(5)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" ORDER BY "user"."id" DESC LIMIT $1 OFFSET $2',
      parameters: [10, 5],
    })
  })

  it('creates a query with where, orderBy, limit, and offset', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .where(({ user }) => user.id['='](user.id))
      .orderBy(({ user }) => user.id.desc())
      .limit(10)
      .offset(5)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" WHERE "user"."id" = "user"."id" ORDER BY "user"."id" DESC LIMIT $1 OFFSET $2',
      parameters: [10, 5],
    })
  })

  it('limit attenuates - subsequent limit calls use minimum', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .limit(20)
      .limit(10)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" LIMIT $1',
      parameters: [10],
    })
  })

  it('limit attenuates - subsequent limit calls do not increase limit', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .limit(10)
      .limit(20)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" LIMIT $1',
      parameters: [10],
    })
  })

  it('offset accumulates - subsequent offset calls add together', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .offset(5)
      .offset(10)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" OFFSET $1',
      parameters: [15],
    })
  })

  it('offset accumulates with multiple calls', () => {
    const query = User.from()
      .select(({ user }) => ({ id: user.id, name: user.name }))
      .offset(5)
      .offset(10)
      .offset(3)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "id", "user"."name" as "name" FROM "users" AS "user" OFFSET $1',
      parameters: [18],
    })
  })

  it('creates a query with joins, where, orderBy, limit, and offset', () => {
    const query = User.from()
      .join(Post, ({ user, post }) => user.id['='](post.userId))
      .select(({ user, post }) => ({
        userName: user.name,
        postTitle: post.title,
      }))
      .where(({ user }) => user.id['='](user.id))
      .orderBy(({ user }) => user.id.desc())
      .limit(10)
      .offset(5)

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."name" as "userName", "post"."title" as "postTitle" FROM "users" AS "user" JOIN "posts" AS "post" ON "user"."id" = "post"."user_id" WHERE "user"."id" = "user"."id" ORDER BY "user"."id" DESC LIMIT $1 OFFSET $2',
      parameters: [10, 5],
    })
  })

  it('can use `as` inline to alias the table', () => {
    const query = User.from()
      .join(User.as('manager'), ({ user, manager }) => manager.id['='](user.managerId))
      .select(({ user, manager }) => ({
        userId: user.id,
        managerId: manager.id,
        userName: user.name,
        managerName: manager.name,
      }))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."id" as "userId", "manager"."id" as "managerId", "user"."name" as "userName", "manager"."name" as "managerName" FROM "users" AS "user" JOIN "users" AS "manager" ON "manager"."id" = "user"."manager_id"',
      parameters: [],
    })
  })

  it('cannot use unsafe alias (table alias)', () => {
    expect(() => User.as('user name').compile()).toThrow('Alias must be a safe alias: "user name" does not match the regex ^[a-zA-Z_][a-zA-Z0-9_]*$')
  })

  it('cannot use unsafe alias (column alias)', () => {
    expect(() => User.from().select(({ user }) => ({ '--whoa': user.name })).compile()).toThrow('Alias must be a safe alias: "--whoa" does not match the regex ^[a-zA-Z_][a-zA-Z0-9_]*$')
  })

  it('cannot use unsafe alias (__proto__)', () => {
    expect(() => User.from().select(({ user }) => {
      const o = Object.create(null)
      // eslint-disable-next-line no-restricted-properties, no-proto
      o.__proto__ = 'bar'
      o.realName = user.name
      return o
    }).compile()).toThrow('Alias must be a safe alias: "__proto__" does not match the regex ^[a-zA-Z_][a-zA-Z0-9_]*$')
  })
})

describe('table methods', () => {
  it('can join a table method', () => {
    const query = User.from()
      .join(({ user }) => user.posts())
      .select(({ user, post }) => ({ name: user.name, title: post.title }))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "user"."name" as "name", "post"."title" as "title" FROM "users" AS "user" JOIN "posts" AS "post" ON "post"."user_id" = "user"."id"',
      parameters: [],
    })
  })

  it('raw `on` expression is moved into the where expression', () => {
    const query = Post.on(post => post.userId['='](new LiteralExpression(1))).from()

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "post"."id" as "id", "post"."user_id" as "userId", "post"."title" as "title", "post"."content" as "content" FROM "posts" AS "post" WHERE "post"."user_id" = $1',
      parameters: [1],
    })
  })

  it('raw `on` expression is anded into the where expression', () => {
    const query = Post.on(post => post.userId['='](new LiteralExpression(1))).from().where(({ post }) => post.title['='](new LiteralExpression('Hello, world!')))

    expect(compiledQuery(query.compile())).toEqual({
      sql: 'SELECT "post"."id" as "id", "post"."user_id" as "userId", "post"."title" as "title", "post"."content" as "content" FROM "posts" AS "post" WHERE "post"."title" = $1 AND "post"."user_id" = $2',
      parameters: ['Hello, world!', 1],
    })
  })

  it('can use table method from subselect', () => {
    const subquery = User.from()
      .join(User.as('u2').from().select(({ u2 }) => u2), ({ user, u2 }) => user.managerId['='](u2.id))
      .join(({ u2 }) => u2.posts())
      .select(({ user, u2, post }) => ({ userId: user.id, managerName: u2.name, managerPostTitle: post.title }))

    const expectedUserSubquery = 'SELECT "u2"."id" as "id", "u2"."name" as "name", "u2"."email" as "email", "u2"."age" as "age", "u2"."score" as "score", "u2"."active" as "active", "u2"."manager_id" as "managerId" FROM "users" AS "u2"'
    expect(compiledQuery(subquery.compile())).toEqual({
      sql: `SELECT "user"."id" as "userId", "u2"."name" as "managerName", "post"."title" as "managerPostTitle" FROM "users" AS "user" JOIN (${expectedUserSubquery}) AS "u2" ON "user"."manager_id" = "u2"."id" JOIN "posts" AS "post" ON "post"."user_id" = "u2"."id"`,
      parameters: [],
    })
  })
})
