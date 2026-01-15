import type { TableClass } from './sql/builder'
import { z } from 'zod'
import { RpcToolset, tool } from './rpc-toolset'
import { Table } from './sql/builder'

export class TestToolset extends RpcToolset {
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

export class TestToolset2 extends RpcToolset {
  @tool(z.object({
    a: z.number(),
    b: z.number(),
  }))
  async subtract(input: { a: number, b: number }) {
    return input.a - input.b
  }
}

export class User extends (Table('users').as('user') as TableClass<'user'>) {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')
  age = this.column('age')

  @tool()
  posts() {
    return Post.on(post => post.userId['='](this.id))
  }
}

export class Post extends (Table('posts').as('post') as TableClass<'post'>) {
  id = this.column('id')
  userId = this.column('user_id')
  title = this.column('title')
  content = this.column('content')
}
