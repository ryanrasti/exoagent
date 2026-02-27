import { describe, expect, it } from 'vitest'
import { codemode } from '../code-mode'
import { exoFn } from '../exoeval'
import { tool } from '../exoeval/tool'
import { Database } from './builder'
import { sql } from './sql'
import { pgliteDialect } from './test-helpers'

const db = new Database(pgliteDialect)

class User extends db.Table('users').as('user') {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')

  @tool()
  posts() {
    return Post.on(post => post.userId['='](this.id)).from()
  }
}

class Post extends db.Table('posts').as('post') {
  id = this.column('id')
  userId = this.column('user_id')
  title = this.column('title')
  content = this.column('content')
}

class Api {
  @tool()
  users() {
    return User.from()
  }

  @tool()
  posts() {
    return Post.from()
  }

  @tool()
  postsClass() {
    return Post
  }
}

db.execute(sql`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)`)
db.execute(sql`INSERT INTO users (id, name, email) VALUES (1, 'John Doe', 'john.doe@example.com')`)
db.execute(sql`INSERT INTO users (id, name, email) VALUES (2, 'Jane Doe', 'jane.doe@example.com')`)

db.execute(sql`CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, content TEXT)`)
db.execute(sql`INSERT INTO posts (id, user_id, title, content) VALUES (1, 1, 'Hello, world!', 'This is a test post')`)
db.execute(sql`INSERT INTO posts (id, user_id, title, content) VALUES (2, 2, 'Hello, world!', 'This is a test post')`)

describe('sql integration over exoeval', () => {
  it('executes a basic query over RPC', async () => {
    const fn = exoFn(async (api: Api) => {
      const users = api.users()
      const query = users.select(({ user }) => ({
        id: user.id,
        name: user.name,
      }))

      return await query.execute()
    })

    const { results } = await fn(new Api())
    expect(results).toEqual([{ id: 1, name: 'John Doe' }, { id: 2, name: 'Jane Doe' }])
  })

  it('executes a join query over RPC', async () => {
    const fn = exoFn(async (api: Api) => {
      const users = api.users()
      const posts = api.posts()
      const join = users.join(posts, ({ user, post }) => user.id['=']((post as Post).userId))
      const query = join.select(({ user, post }) => ({
        id: user.id,
        name: user.name,
        title: (post as Post).title,
      }))

      return await query.execute()
    })

    const { results } = await fn(new Api())
    expect(results).toEqual([{ id: 1, name: 'John Doe', title: 'Hello, world!' }, { id: 2, name: 'Jane Doe', title: 'Hello, world!' }])
  })

  it('executes a nested closures', async () => {
    const fn = exoFn(async (api: Api) => {
      return await api.users()
        // TODO: for some reaons we need the explicit `{ user: User }` so that the right
        //   type is inferred later.
        .join(({ user }: { user: User }) => api.posts().select(({ post }) => ({
          userName: user.name,
          userId: post.userId,
          postId: post.id,
          postTitle: post.title,
        }),
        ), ({ user, post }) => user.id['='](post.userId))
        .select(({ user, post }) => ({
          userName: user.name,
          postUserName: post.userName,
          userId: post.userId,
          postId: post.postId,
          postTitle: post.postTitle,
        }))
        .execute()
    })

    const { results } = await fn(new Api())
    expect(results).toEqual([{ userName: 'John Doe', postUserName: 'John Doe', userId: 1, postId: 1, postTitle: 'Hello, world!' }, { userName: 'Jane Doe', postUserName: 'Jane Doe', userId: 2, postId: 2, postTitle: 'Hello, world!' }])
  })

  it('cannot reference unexposed properties', async () => {
    const api = new Api()
    expect(exoFn((api: Api) => api.users().compile)(api)).toBeUndefined()
    expect(() => (exoFn((api: Api) => api.users().compile())(api))).toThrow(/callee is not a toolable function \(value: undefined\)/)

    // Just for sanity, a different field should be accessible:
    expect(exoFn((api: Api) => api.users().limit)(api)).toBeDefined()

    const fn2 = exoFn(async (api: Api) => {
      const users = api.users()
      return users.select(({ user }) => ({ foo: user.column('foo') }))
    })
    await expect(fn2(new Api())).rejects.toThrow(/callee is not a toolable function \(value: undefined\)/)
  })

  it('can do a join to a toolset method', async () => {
    const fn = exoFn(async ({ users }: Api) => {
      return await users().join(({ user }) => user.posts()).select(({ user, post }) => ({ userName: user.name, postTitle: post.title })).execute()
    })

    const { results } = await fn(new Api())

    expect(results).toEqual([{ userName: 'John Doe', postTitle: 'Hello, world!' }, { userName: 'Jane Doe', postTitle: 'Hello, world!' }])
  })
})

describe('sql integration with codemode', () => {
  it('executes a basic select via codemode', async () => {
    const codeTool = await codemode(new Api(), `class User extends db.Table('users').as('user') {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')
}`)

    const result = await codeTool.execute({
      code: `async ({ users }) => {
        return await users()
          .select(({ user }) => ({ id: user.id, name: user.name }))
          .execute()
      }`,
    }, { toolCallId: 'test-1', messages: [] })

    expect(result).toEqual({ results: [{ id: 1, name: 'John Doe' }, { id: 2, name: 'Jane Doe' }] })
  })

  it('executes a join via codemode', async () => {
    const codeTool = await codemode({ users: User.from() }, `class User extends db.Table('users').as('user') {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')

  @tool()
  posts() {
    return Post.on(post => post.userId['='](this.id)).from()
  }
}

class Post extends db.Table('posts').as('post') {
  id = this.column('id')
  userId = this.column('user_id')
  title = this.column('title')
  content = this.column('content')
}`)

    const result = await codeTool.execute({
      code: `async ({ users }) => {
        return await users
          .join(({ user }) => user.posts())
          .select(({ user, post }) => ({ userName: user.name, postTitle: post.title }))
          .execute()
      }`,
    }, { toolCallId: 'test-2', messages: [] })

    expect(result).toEqual({ results: [{ userName: 'John Doe', postTitle: 'Hello, world!' }, { userName: 'Jane Doe', postTitle: 'Hello, world!' }] })
  })
})
