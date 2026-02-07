import { describe, expect, it } from 'vitest'
import z from 'zod'
import { safeEval, Value } from './eval'
import { ExoAgent } from './policy'

const exo = new ExoAgent(['taint1', 'taint2'], ['taint1'])

// Create a test toolset with 3 methods:
// - source1: emits 'taint1' source
// - source2: emits 'taint2' source
// - sink: accepts 'taint1' sink
class TestPolicyToolset {
  @exo.tool({ source: ['taint1'] })
  source1() {
    return 'data from source1'
  }

  @exo.tool({ source: ['taint2'] })
  source2() {
    return 'data from source2'
  }

  @exo.tool(z.string(), { sink: ['taint1'] })
  sink(input: string) {
    return `sink received: ${input}`
  }
}

describe('policy', () => {
  it('allows source1 -> sink flow (taint1 source to taint1 sink)', () => {
    const toolset = new TestPolicyToolset()
    const policy = exo.policy([
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ])

    // Call source1 which emits taint1
    const source1Method = Value.of(toolset.source1, [])
    const source1Result = policy.doStubCall(
      { propertyName: 'source1', parent: Value.of(toolset, []) },
      source1Method as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [],
    )

    // Verify source1 result has taint1
    expect(source1Result.getTaints()).toContain('taint1')
    expect(source1Result.raw).toBe('data from source1')

    // Call sink with taint1 data - should pass
    const sinkMethod = Value.of(toolset.sink, [])
    const sinkArg = Value.of('data from source1', source1Result.getTaints())
    const sinkResult = policy.doStubCall(
      { propertyName: 'sink', parent: Value.of(toolset, []) },
      sinkMethod as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [sinkArg],
    )

    expect(sinkResult.raw).toBe('sink received: data from source1')
  })

  it('denies source2 -> sink flow (taint2 source to taint1 sink)', () => {
    const toolset = new TestPolicyToolset()
    const policy = exo.policy([
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ])

    // Call source2 which emits taint2
    const source2Method = Value.of(toolset.source2, [])
    const source2Result = policy.doStubCall(
      { propertyName: 'source2', parent: Value.of(toolset, []) },
      source2Method as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [],
    )

    // Verify source2 result has taint2
    expect(source2Result.getTaints()).toContain('taint2')
    expect(source2Result.raw).toBe('data from source2')

    // Call sink with taint2 data - should be denied by deny rule
    const sinkMethod = Value.of(toolset.sink, [])
    const sinkArg = Value.of('data from source2', source2Result.getTaints())
    expect(() => {
      policy.doStubCall(
        { propertyName: 'sink', parent: Value.of(toolset, []) },
        sinkMethod as Value<(...args: any[]) => any>,
        Value.of(toolset, []),
        [sinkArg],
      )
    }).toThrow('Method call denied: taint2 are not allowed to be used as sources and taint1 are not allowed to be used as sinks')
  })

  it('allows source1 -> sink flow end-to-end through evaluator', async () => {
    const toolset = new TestPolicyToolset()
    const policy = exo.policy([
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ])

    // Evaluate code that calls source1 then sink
    // Pass toolset directly as RpcStub (RpcToolset extends RpcTarget which can be wrapped in RpcStub)
    const result = safeEval(
      'sink(source1())',
      Value.of(toolset, []),
      policy.doStubCall.bind(policy),
    ) as Value<string>

    expect(result.raw).toBe('sink received: data from source1')
  })

  it('denies source2 -> sink flow end-to-end through evaluator', async () => {
    const toolset = new TestPolicyToolset()
    const policy = exo.policy([
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ])

    // Evaluate code that calls source2 then sink - should be denied
    // Pass toolset directly as RpcStub (RpcToolset extends RpcTarget which can be wrapped in RpcStub)
    expect(
      () => safeEval(
        'sink(source2())',
        Value.of(toolset, []),
        policy.doStubCall.bind(policy),
      ),
    ).toThrow('Method call denied: taint2 are not allowed to be used as sources and taint1 are not allowed to be used as sinks')
  })
})
