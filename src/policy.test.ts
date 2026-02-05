import { RpcStub } from 'capnweb'
import { safeEval, Value } from 'capnweb-eval'
import { describe, expect, it } from 'vitest'
import { Policy } from './policy'
import { RpcToolset, tool } from './rpc-toolset'

// Create a test toolset with 3 methods:
// - source1: emits 'taint1' source
// - source2: emits 'taint2' source
// - sink: accepts 'taint1' sink
class TestPolicyToolset extends RpcToolset {
  @tool.unsafeNoValidation({ sources: ['taint1'] })
  source1() {
    return 'data from source1'
  }

  @tool.unsafeNoValidation({ sources: ['taint2'] })
  source2() {
    return 'data from source2'
  }

  @tool.unsafeNoValidation({ sinks: ['taint1'] })
  sink(input: string) {
    return `sink received: ${input}`
  }
}

describe('policy', () => {
  it('allows source1 -> sink flow (taint1 source to taint1 sink)', () => {
    const toolset = new TestPolicyToolset()
    const policy = new Policy(['taint1', 'taint2'], ['taint1'], [
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ])

    // Call source1 which emits taint1
    const source1Method = Value.of(toolset.source1, [])
    const source1Result = policy.doStubCall(
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
      sinkMethod as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [sinkArg],
    )

    expect(sinkResult.raw).toBe('sink received: data from source1')
  })

  it('denies source2 -> sink flow (taint2 source to taint1 sink)', () => {
    const toolset = new TestPolicyToolset()
    const policy = new Policy(['taint1', 'taint2'], ['taint1'], [
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ])

    // Call source2 which emits taint2
    const source2Method = Value.of(toolset.source2, [])
    const source2Result = policy.doStubCall(
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
        sinkMethod as Value<(...args: any[]) => any>,
        Value.of(toolset, []),
        [sinkArg],
      )
    }).toThrow('Method call denied: taint2 are not allowed to be used as sources and taint1 are not allowed to be used as sinks')
  })

  it('allows source1 -> sink flow end-to-end through evaluator', async () => {
    const toolset = new TestPolicyToolset()
    const policy = new Policy(['taint1', 'taint2'], ['taint1'], [
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ])

    // Evaluate code that calls source1 then sink
    // Pass toolset directly as RpcStub (RpcToolset extends RpcTarget which can be wrapped in RpcStub)
    const result = await safeEval(
      'sink(source1())',
      toolset,
      policy.doStubCall.bind(policy),
    )

    expect(result.raw).toBe('sink received: data from source1')
  })

  it('denies source2 -> sink flow end-to-end through evaluator', async () => {
    const toolset = new TestPolicyToolset()
    const policy = new Policy(['taint1', 'taint2'], ['taint1'], [
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ])

    // Evaluate code that calls source2 then sink - should be denied
    // Pass toolset directly as RpcStub (RpcToolset extends RpcTarget which can be wrapped in RpcStub)
    await expect(
      safeEval(
        'sink(source2())',
        toolset,
        policy.doStubCall.bind(policy),
      ),
    ).rejects.toThrow('Method call denied: taint2 are not allowed to be used as sources and taint1 are not allowed to be used as sinks')
  })
})
