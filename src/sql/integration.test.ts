import { setGlobalRpcSessionOptions } from 'capnweb'
import { describe, expect, it } from 'vitest'
import { TestHarness } from '../capnweb-test-helpers'
import { RpcToolset, tool } from '../rpc-toolset'
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

class Api extends RpcToolset {
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

setGlobalRpcSessionOptions(() => ({ recordReplayMode: 'all' }))

describe('sql integration over capnweb', () => {
  it('executes a basic query over RPC', async () => {
    await using harness = new TestHarness(new Api())
    const api = harness.stub

    using users = api.users()
    using query = users.select(({ user }) => ({
      id: user.id,
      name: user.name,
    }))

    const result = await query.execute()

    expect(result).toEqual([{ id: 1, name: 'John Doe' }, { id: 2, name: 'Jane Doe' }])
  })

  it('executes a join query over RPC', async () => {
    await using harness = new TestHarness(new Api())
    const api = harness.stub

    using users = api.users()
    using posts = api.posts()
    // Unfortuneately when wrapping with stubs, some generics get lost so we need
    //  manual type assertions to get the right types.
    // @ts-expect-error - there's also random TS issues here:L
    using join = users.join(posts, ({ user, post }) => user.id['=']((post as Post).userId))
    using query = join.select(({ user, post }) => ({
      id: user.id,
      name: user.name,
      title: (post as Post).title,
    }))

    const result = await query.execute()

    expect(result).toEqual([{ id: 1, name: 'John Doe', title: 'Hello, world!' }, { id: 2, name: 'Jane Doe', title: 'Hello, world!' }])
  })

  it('executes a query in a `map` (no `usings` needed)', async () => {
    await using harness = new TestHarness(new Api())
    const api = harness.stub

    const result = await api.map(api =>
      api.users().select(({ user }) => ({
        id: user.id,
        name: user.name,
      })).execute(),
    )
    expect(result).toEqual([{ id: 1, name: 'John Doe' }, { id: 2, name: 'Jane Doe' }])
  })

  it('executes a nested closures in a `map` (no `usings` needed)', async () => {
    // const localResult = await new Api().users().join(({ user }) => new Api().posts().select(({ user }) => ({
    //   id: user.id,
    //   name: user.name,
    // })).execute(), ({ user, post }) => user.id['='](post.userId))

    // expect(localResult).toEqual([{ id: 1, name: 'John Doe' }, { id: 2, name: 'Jane Doe' }])

    await using harness = new TestHarness(new Api())
    const api = harness.stub

    const result = await api.map(api =>
      api.users()
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
        .execute(),
    )
    expect(result).toEqual([{ userName: 'John Doe', postUserName: 'John Doe', userId: 1, postId: 1, postTitle: 'Hello, world!' }, { userName: 'Jane Doe', postUserName: 'Jane Doe', userId: 2, postId: 2, postTitle: 'Hello, world!' }])
  })

  it('cannot reference own properties', async () => {
    await using harness = new TestHarness(new Api())
    const api = harness.stub

    await expect(async () => {
      using users = api.users()
      return await users.compile()
    }).rejects.toThrow('Attempted to access property \'compile\', which is an instance property of the RpcTarget.')

    await expect(async () => {
      using users = api.users()
      return await users.select(
        ({ user }) => ({ foo: user.column('foo') }),
      )
    }).rejects.toThrow('Attempted to access property \'column\', which is an instance property of the RpcTarget.')

    // TODO: this is actually being allowed, but it shouldn't be:
    await expect(async () => {
      using posts = api.posts()
      return await posts.compile()
    }).rejects.toThrow('Attempted to access property \'compile\', which is an instance property of the RpcTarget.')
  })

  it('can do a join to a toolset method', async () => {
    await using harness = new TestHarness(new Api())
    const api = harness.stub

    const result = await api.map(api =>
      api.users().join(({ user }) => user.posts()).select(({ user, post }) => ({ userName: user.name, postTitle: post.title })).execute(),
    )

    expect(result).toEqual([{ userName: 'John Doe', postTitle: 'Hello, world!' }, { userName: 'Jane Doe', postTitle: 'Hello, world!' }])
  })
})
