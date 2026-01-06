import { z } from 'zod'
import { RpcToolset, tool } from './rpc-toolset'

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
