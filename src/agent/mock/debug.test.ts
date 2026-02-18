import { describe, it, expect } from 'vitest'
import { safeEval, GlobalScope, Value, registerArrayValueFactory } from '../../eval'
import { createMockAgent, mockPolicy } from './index'

registerArrayValueFactory()

describe('debug IFC', () => {
  it('trace async map result structure', async () => {
    const mockAgent = createMockAgent()

    // Step 1: Just call gmail.list and map without async
    const code1 = `
const emails = await api.gmail.list({ maxResults: 1, query: "" })
emails.map(e => e.id)
`

    const scope = new GlobalScope(Value.of({
      api: Value.of(mockAgent.api, [], { shallow: true }),
      builtin: Value.of(mockAgent.builtin, [], { shallow: true }),
    }, [], { shallow: true }), false)

    const turn = mockPolicy.turn(100, [])

    const result1 = await safeEval(code1, scope, turn.doStubCall.bind(turn))
    console.log('Sync map result taints:', JSON.stringify(result1.getTaints(), null, 2))
    console.log('Sync map item[0] taints:', JSON.stringify((result1.raw as Value[])[0]?.getTaints?.(), null, 2))
  })

  it('trace async map before builtin.all', async () => {
    const mockAgent = createMockAgent()

    // Step 2: Async map but no builtin.all
    const code2 = `
const emails = await api.gmail.list({ maxResults: 1, query: "" })
const promises = emails.map(async e => {
  const detail = await api.gmail.get({ id: e.id })
  return detail
})
promises
`

    const scope = new GlobalScope(Value.of({
      api: Value.of(mockAgent.api, [], { shallow: true }),
      builtin: Value.of(mockAgent.builtin, [], { shallow: true }),
    }, [], { shallow: true }), false)

    const turn = mockPolicy.turn(100, [])

    const result2 = await safeEval(code2, scope, turn.doStubCall.bind(turn))
    console.log('Async map result taints:', JSON.stringify(result2.getTaints(), null, 2))
    const firstItem = (result2.raw as Value[])[0]
    console.log('Async map item[0] is Value:', firstItem instanceof Value)
    console.log('Async map item[0] taints:', JSON.stringify(firstItem?.getTaints?.(), null, 2))
    console.log('Async map item[0].raw is Promise:', firstItem?.raw instanceof Promise)

    // Now await the promise to see what it resolves to
    const resolved = await firstItem?.raw
    console.log('Resolved is Value:', resolved instanceof Value)
    console.log('Resolved taints:', JSON.stringify(resolved?.getTaints?.(), null, 2))
  })

  it('trace builtin.all result', async () => {
    const mockAgent = createMockAgent()

    const code3 = `
const emails = await api.gmail.list({ maxResults: 1, query: "" })
const promises = emails.map(async e => {
  const detail = await api.gmail.get({ id: e.id })
  return detail
})
const results = await builtin.all(promises)
results
`

    const scope = new GlobalScope(Value.of({
      api: Value.of(mockAgent.api, [], { shallow: true }),
      builtin: Value.of(mockAgent.builtin, [], { shallow: true }),
    }, [], { shallow: true }), false)

    const turn = mockPolicy.turn(100, [])

    const result3 = await safeEval(code3, scope, turn.doStubCall.bind(turn))
    console.log('After builtin.all taints:', JSON.stringify(result3.getTaints(), null, 2))
    const firstItem = (result3.raw as Value[])[0]
    console.log('After builtin.all item[0] is Value:', firstItem instanceof Value)
    console.log('After builtin.all item[0] taints:', JSON.stringify(firstItem?.getTaints?.(), null, 2))
    // Check if firstItem.raw has taints (in case it's double-wrapped)
    if (firstItem?.raw instanceof Value) {
      console.log('After builtin.all item[0].raw is also Value:', true)
      console.log('After builtin.all item[0].raw taints:', JSON.stringify(firstItem.raw.getTaints(), null, 2))
    }
  })

  it('trace Value.of with Value array', () => {
    // Directly test Value.of with an array of already-tainted Values
    const item1 = Value.of({ id: 'email-1' }, [['email', { principals: ['alice@example.com'] }]])
    const item2 = Value.of({ id: 'email-2' }, [['email', { principals: ['bob@example.com'] }]])
    const arr = [item1, item2]

    console.log('Before Value.of:')
    console.log('  item1 taints:', JSON.stringify(item1.getTaints(), null, 2))
    console.log('  item2 taints:', JSON.stringify(item2.getTaints(), null, 2))

    const wrapped = Value.of(arr, [])
    console.log('After Value.of:')
    console.log('  wrapped taints:', JSON.stringify(wrapped.getTaints(), null, 2))
    console.log('  wrapped.raw[0] taints:', JSON.stringify((wrapped.raw as Value[])[0]?.getTaints?.(), null, 2))
  })

  it('trace Promise.all with Value-resolving promises', async () => {
    // Simulate what builtin.all does
    const item1 = Value.of({ id: 'email-1' }, [['email', { principals: ['alice@example.com'] }]])
    const item2 = Value.of({ id: 'email-2' }, [['email', { principals: ['bob@example.com'] }]])

    const promises = [
      Promise.resolve(item1),
      Promise.resolve(item2),
    ]

    const results = await Promise.all(promises)
    console.log('Promise.all results:')
    console.log('  results[0] is Value:', results[0] instanceof Value)
    console.log('  results[0] taints:', JSON.stringify(results[0]?.getTaints?.(), null, 2))
    console.log('  results[1] is Value:', results[1] instanceof Value)
    console.log('  results[1] taints:', JSON.stringify(results[1]?.getTaints?.(), null, 2))

    // Now wrap with Value.of
    const wrapped = Value.of(results, [])
    console.log('After Value.of:')
    console.log('  wrapped taints:', JSON.stringify(wrapped.getTaints(), null, 2))
    console.log('  wrapped.raw[0] taints:', JSON.stringify((wrapped.raw as Value[])[0]?.getTaints?.(), null, 2))
  })
})
