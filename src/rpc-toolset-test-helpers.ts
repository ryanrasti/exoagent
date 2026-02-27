import { z } from 'zod'
import { tool } from './exoeval/tool'
import { Database } from './sql/builder'
import { dummyDialect } from './sql/test-helpers'

export class TestToolset {
  @tool(z.object({
    a: z.number(),
    b: z.number(),
  }))
  async add(input: { a: number, b: number }) {
    return input.a + input.b
  }

  @tool()
  async toolset2() {
    return new TestToolset2()
  }

  @tool(z.object({
    id: z.string(),
  }))
  async userForId({ id }: { id: string }) {
    return User.on(user => user.id['='](id))
  }
}

export class TestToolset2 {
  @tool(z.object({
    a: z.number(),
    b: z.number(),
  }))
  async subtract(input: { a: number, b: number }) {
    return input.a - input.b
  }
}

const db = new Database(dummyDialect)

export class User extends db.Table('users').as('user') {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')
  age = this.column('age')

  @tool()
  posts() {
    return Post.on(post => post.userId['='](this.id))
  }
}

export class Post extends db.Table('posts').as('post') {
  id = this.column('id')
  userId = this.column('user_id')
  title = this.column('title')
  content = this.column('content')
}
