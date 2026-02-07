import { describe, expect, it } from 'vitest'
import { codeMode } from '../code-mode'
import { ExoAgent } from '../policy'
import { Database } from './builder'
import { sql } from './sql'
import { pgliteDialect } from './test-helpers'

const exo = new ExoAgent([], [])
const policy = exo.policy([])

const db = new Database(pgliteDialect)

class User extends db.Table('users').as('user') {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')

  @exo.tool()
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
  @exo.tool()
  users() {
    return User.from()
  }

  @exo.tool()
  posts() {
    return Post.from()
  }

  @exo.tool()
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

describe('sql integration with eval sandbox', () => {
  it('executes a basic select via CodeMode', async () => {
    const codeTool = codeMode({
      api: new Api(),
    }, policy, `class User extends db.Table('users').as('user') {
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

  it('executes a join via CodeMode', async () => {
    const codeTool = codeMode({
      api: new Api(),
    }, policy, `class User extends db.Table('users').as('user') {
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
        return await users()
          .join(({ user }) => user.posts())
          .select(({ user, post }) => ({ userName: user.name, postTitle: post.title }))
          .execute()
      }`,
    }, { toolCallId: 'test-2', messages: [] })

    expect(result).toEqual({ results: [{ userName: 'John Doe', postTitle: 'Hello, world!' }, { userName: 'Jane Doe', postTitle: 'Hello, world!' }] })
  })
})
