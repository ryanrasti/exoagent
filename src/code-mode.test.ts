import { describe, expect, it } from 'vitest'
import z from 'zod'
import { codeMode } from './code-mode'
import { ExoAgent } from './policy'

const exo = new ExoAgent([], [])
const policy = exo.policy([])

class TestToolset {
  @exo.tool(z.object({ a: z.number(), b: z.number() }))
  add({ a, b }: { a: number, b: number }) {
    return a + b
  }

  @exo.tool(z.object({ a: z.number(), b: z.number() }))
  subtract({ a, b }: { a: number, b: number }) {
    return a - b
  }
}

describe('codeMode (capnweb-eval)', () => {
  it('executes user code that calls RpcToolset tools', async () => {
    const wrappedTool = codeMode({ api: new TestToolset() }, policy, '')
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        const toolset = await api
        const addResult = api.add({ a: 10, b: 5 })
        return { result: addResult }
      }`,
    })

    expect(result).toEqual({ result: 15 })
  })

  it('executes user code that chains RpcToolset tools', async () => {
    const wrappedTool = codeMode({ api: new TestToolset() }, policy, '')
    const result = await (wrappedTool.execute as (input: { code: string }) => Promise<unknown>)({
      code: `async (api) => {
        return api.subtract({ a: 20, b: 8 })
      }`,
    })

    expect(result).toEqual(12)
  })
})
