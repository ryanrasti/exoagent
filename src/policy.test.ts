import { describe, expect, it } from 'vitest'
import z from 'zod'
import { safeEval, Value } from './eval'
import { ExoAgent, fn, tool } from './policy'

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

describe('policy - multiple deny rules', () => {
  const multiExo = new ExoAgent(
    ['userInput', 'networkData', 'fileData'] as const,
    ['database', 'fileSystem', 'network'] as const,
  )

  class MultiSourceToolset {
    @multiExo.tool({ source: ['userInput'] })
    getUserInput() { return 'user data' }

    @multiExo.tool({ source: ['networkData'] })
    getNetworkData() { return 'network data' }

    @multiExo.tool({ source: ['fileData'] })
    getFileData() { return 'file data' }

    @multiExo.tool(z.string(), { sink: ['database'] })
    writeToDb(data: string) { return `db: ${data}` }

    @multiExo.tool(z.string(), { sink: ['fileSystem'] })
    writeToFile(data: string) { return `file: ${data}` }

    @multiExo.tool(z.string(), { sink: ['network'] })
    sendToNetwork(data: string) { return `network: ${data}` }
  }

  it('enforces multiple deny rules independently', () => {
    const toolset = new MultiSourceToolset()
    const policy = multiExo.policy([
      { sources: ['userInput'], sinks: ['database'] },
      { sources: ['networkData'], sinks: ['fileSystem'] },
    ])

    // userInput -> database: DENIED
    const userInput = policy.doStubCall(
      { propertyName: 'getUserInput', parent: Value.of(toolset, []) },
      Value.of(toolset.getUserInput, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )
    expect(() => {
      policy.doStubCall(
        { propertyName: 'writeToDb', parent: Value.of(toolset, []) },
        Value.of(toolset.writeToDb, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [userInput],
      )
    }).toThrow(/Method call denied/)

    // userInput -> fileSystem: ALLOWED
    const fileResult = policy.doStubCall(
      { propertyName: 'writeToFile', parent: Value.of(toolset, []) },
      Value.of(toolset.writeToFile, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [userInput],
    )
    expect(fileResult.raw).toBe('file: user data')

    // networkData -> fileSystem: DENIED
    const networkData = policy.doStubCall(
      { propertyName: 'getNetworkData', parent: Value.of(toolset, []) },
      Value.of(toolset.getNetworkData, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )
    expect(() => {
      policy.doStubCall(
        { propertyName: 'writeToFile', parent: Value.of(toolset, []) },
        Value.of(toolset.writeToFile, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [networkData],
      )
    }).toThrow(/Method call denied/)

    // networkData -> database: ALLOWED
    const dbResult = policy.doStubCall(
      { propertyName: 'writeToDb', parent: Value.of(toolset, []) },
      Value.of(toolset.writeToDb, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [networkData],
    )
    expect(dbResult.raw).toBe('db: network data')
  })

  it('handles overlapping deny rules', () => {
    const toolset = new MultiSourceToolset()
    const policy = multiExo.policy([
      { sources: ['userInput'], sinks: ['database'] },
      { sources: ['userInput'], sinks: ['network'] }, // overlapping source
    ])

    const userInput = policy.doStubCall(
      { propertyName: 'getUserInput', parent: Value.of(toolset, []) },
      Value.of(toolset.getUserInput, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )

    // Both sinks should be denied
    expect(() => {
      policy.doStubCall(
        { propertyName: 'writeToDb', parent: Value.of(toolset, []) },
        Value.of(toolset.writeToDb, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [userInput],
      )
    }).toThrow(/Method call denied/)

    expect(() => {
      policy.doStubCall(
        { propertyName: 'sendToNetwork', parent: Value.of(toolset, []) },
        Value.of(toolset.sendToNetwork, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [userInput],
      )
    }).toThrow(/Method call denied/)

    // fileSystem should be allowed
    const fileResult = policy.doStubCall(
      { propertyName: 'writeToFile', parent: Value.of(toolset, []) },
      Value.of(toolset.writeToFile, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [userInput],
    )
    expect(fileResult.raw).toBe('file: user data')
  })
})

describe('policy - multiple sources and sinks on single tool', () => {
  const multiExo = new ExoAgent(
    ['source1', 'source2', 'source3'] as const,
    ['sink1', 'sink2'] as const,
  )

  class MultiAnnotationToolset {
    @multiExo.tool({ source: ['source1', 'source2'] })
    dualSource() { return 'dual source data' }

    @multiExo.tool(z.string(), { sink: ['sink1', 'sink2'] })
    dualSink(data: string) { return `dual sink: ${data}` }

    @multiExo.tool({ source: ['source3'] })
    singleSource() { return 'single source' }
  }

  it('tool with multiple sources emits all source taints', () => {
    const toolset = new MultiAnnotationToolset()
    const policy = multiExo.policy([])

    const result = policy.doStubCall(
      { propertyName: 'dualSource', parent: Value.of(toolset, []) },
      Value.of(toolset.dualSource, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )

    expect(result.getTaints()).toContain('source1')
    expect(result.getTaints()).toContain('source2')
  })

  it('tool with multiple sinks is denied if any sink matches deny rule', () => {
    const toolset = new MultiAnnotationToolset()
    const policy = multiExo.policy([
      { sources: ['source3'], sinks: ['sink1'] }, // Only denies sink1, but dualSink has both
    ])

    const sourceData = policy.doStubCall(
      { propertyName: 'singleSource', parent: Value.of(toolset, []) },
      Value.of(toolset.singleSource, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )

    expect(() => {
      policy.doStubCall(
        { propertyName: 'dualSink', parent: Value.of(toolset, []) },
        Value.of(toolset.dualSink, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [sourceData],
      )
    }).toThrow(/Method call denied/)
  })
})

describe('policy - chained tool calls and taint propagation', () => {
  const chainExo = new ExoAgent(
    ['untrusted', 'trusted'] as const,
    ['sensitive'] as const,
  )

  class ChainToolset {
    @chainExo.tool({ source: ['untrusted'] })
    getUntrusted() { return 'untrusted data' }

    @chainExo.tool({ source: ['trusted'] })
    getTrusted() { return 'trusted data' }

    @chainExo.tool(z.string())
    transform(data: string) { return `transformed: ${data}` }

    @chainExo.tool(z.string(), { sink: ['sensitive'] })
    writeSensitive(data: string) { return `sensitive: ${data}` }
  }

  it('taint propagates through transform tool without source/sink', () => {
    const toolset = new ChainToolset()
    const policy = chainExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ])

    // Get untrusted data
    const untrusted = policy.doStubCall(
      { propertyName: 'getUntrusted', parent: Value.of(toolset, []) },
      Value.of(toolset.getUntrusted, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )

    // Transform it (should preserve taint)
    const transformed = policy.doStubCall(
      { propertyName: 'transform', parent: Value.of(toolset, []) },
      Value.of(toolset.transform, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [untrusted],
    )
    expect(transformed.getTaints()).toContain('untrusted')

    // Should still be denied at sensitive sink
    expect(() => {
      policy.doStubCall(
        { propertyName: 'writeSensitive', parent: Value.of(toolset, []) },
        Value.of(toolset.writeSensitive, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [transformed],
      )
    }).toThrow(/Method call denied/)
  })

  it('trusted data passes through chain to sensitive sink', () => {
    const toolset = new ChainToolset()
    const policy = chainExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ])

    const trusted = policy.doStubCall(
      { propertyName: 'getTrusted', parent: Value.of(toolset, []) },
      Value.of(toolset.getTrusted, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )

    const transformed = policy.doStubCall(
      { propertyName: 'transform', parent: Value.of(toolset, []) },
      Value.of(toolset.transform, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [trusted],
    )

    const result = policy.doStubCall(
      { propertyName: 'writeSensitive', parent: Value.of(toolset, []) },
      Value.of(toolset.writeSensitive, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [transformed],
    )
    expect(result.raw).toBe('sensitive: transformed: trusted data')
  })

  it('chained calls work through evaluator', () => {
    const toolset = new ChainToolset()
    const policy = chainExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ])

    // Trusted chain should work
    const result = safeEval(
      'writeSensitive(transform(getTrusted()))',
      Value.of(toolset, []),
      policy.doStubCall.bind(policy),
    ) as Value<string>
    expect(result.raw).toBe('sensitive: transformed: trusted data')

    // Untrusted chain should fail
    expect(() => safeEval(
      'writeSensitive(transform(getUntrusted()))',
      Value.of(toolset, []),
      policy.doStubCall.bind(policy),
    )).toThrow(/Method call denied/)
  })
})

describe('policy - taint from thisVal vs args', () => {
  const thisExo = new ExoAgent(['objectTaint', 'argTaint'] as const, ['sink'] as const)

  class ThisToolset {
    @thisExo.tool(z.string(), { sink: ['sink'] })
    process(data: string) { return `processed: ${data}` }
  }

  it('checks taints from thisVal', () => {
    const toolset = new ThisToolset()
    const policy = thisExo.policy([
      { sources: ['objectTaint'], sinks: ['sink'] },
    ])

    const taintedThis = Value.of(toolset, ['objectTaint'])
    const cleanArg = Value.of('clean data', [])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'process', parent: taintedThis },
        Value.of(toolset.process, []) as Value<(s: string) => string>,
        taintedThis,
        [cleanArg],
      )
    }).toThrow(/Method call denied/)
  })

  it('checks taints from args', () => {
    const toolset = new ThisToolset()
    const policy = thisExo.policy([
      { sources: ['argTaint'], sinks: ['sink'] },
    ])

    const cleanThis = Value.of(toolset, [])
    const taintedArg = Value.of('tainted data', ['argTaint'])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'process', parent: cleanThis },
        Value.of(toolset.process, []) as Value<(s: string) => string>,
        cleanThis,
        [taintedArg],
      )
    }).toThrow(/Method call denied/)
  })
})

describe('policy - unconfigured taints', () => {
  const limitedExo = new ExoAgent(['configured'] as const, ['configuredSink'] as const)

  it('throws when tool declares unconfigured source taint', () => {
    // This test verifies runtime behavior when a tool's source isn't in the policy's sources
    class BadToolset {
      // @ts-expect-error - intentionally using unconfigured taint
      @limitedExo.tool({ source: ['unconfigured'] })
      badSource() { return 'data' }
    }

    const toolset = new BadToolset()
    const policy = limitedExo.policy([])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'badSource', parent: Value.of(toolset, []) },
        Value.of(toolset.badSource, []) as Value<() => string>,
        Value.of(toolset, []),
        [],
      )
    }).toThrow(/Source taint unconfigured is not configured/)
  })

  it('throws when tool declares unconfigured sink taint', () => {
    class BadToolset {
      // @ts-expect-error - intentionally using unconfigured taint
      @limitedExo.tool(z.string(), { sink: ['unconfiguredSink'] })
      badSink(data: string) { return data }
    }

    const toolset = new BadToolset()
    const policy = limitedExo.policy([])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'badSink', parent: Value.of(toolset, []) },
        Value.of(toolset.badSink, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [Value.of('data', [])],
      )
    }).toThrow(/Sink taint unconfiguredSink is not configured/)
  })

  it('throws when incoming taint is not configured', () => {
    class GoodToolset {
      @limitedExo.tool(z.string(), { sink: ['configuredSink'] })
      goodSink(data: string) { return data }
    }

    const toolset = new GoodToolset()
    const policy = limitedExo.policy([])

    // Create a value with an unconfigured taint (simulating a bug or external data)
    const badTaintedArg = Value.of('data', ['sneakyTaint'])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'goodSink', parent: Value.of(toolset, []) },
        Value.of(toolset.goodSink, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [badTaintedArg],
      )
    }).toThrow(/Source taint sneakyTaint is not configured/)
  })
})

describe('tool decorator validation', () => {
  it('validates input with zod schema', () => {
    class ValidatedToolset {
      @tool(z.number())
      requiresNumber(n: number) { return n * 2 }
    }

    const toolset = new ValidatedToolset()
    expect(toolset.requiresNumber(5)).toBe(10)
    expect(() => toolset.requiresNumber('not a number' as any)).toThrow(/Invalid value/)
  })

  it('validates multiple inputs', () => {
    class MultiValidatedToolset {
      @tool(z.string(), z.number())
      concat(s: string, n: number) { return s + n }
    }

    const toolset = new MultiValidatedToolset()
    expect(toolset.concat('value:', 42)).toBe('value:42')
    expect(() => toolset.concat(123 as any, 42)).toThrow(/Invalid value/)
    expect(() => toolset.concat('value:', 'not a number' as any)).toThrow(/Invalid value/)
  })

  it('throws on too many arguments', () => {
    class LimitedToolset {
      @tool(z.number())
      oneArg(n: number) { return n }
    }

    const toolset = new LimitedToolset()
    expect(() => (toolset.oneArg as any)(1, 2, 3)).toThrow(/too many arguments/)
  })

  it('validates complex schemas', () => {
    class ComplexToolset {
      @tool(z.object({ name: z.string(), age: z.number().min(0) }))
      processUser(user: { name: string, age: number }) {
        return `${user.name} is ${user.age}`
      }
    }

    const toolset = new ComplexToolset()
    expect(toolset.processUser({ name: 'Alice', age: 30 })).toBe('Alice is 30')
    expect(() => toolset.processUser({ name: 'Bob', age: -5 })).toThrow(/Invalid value/)
    expect(() => toolset.processUser({ name: 123 as any, age: 30 })).toThrow(/Invalid value/)
  })
})

describe('fn validator', () => {
  it('validates function return type', () => {
    const schema = fn.returns(z.number())
    const validation = schema['~standard'].validate((x: number) => x * 2)
    expect(validation).not.toHaveProperty('issues')
    expect(typeof (validation as any).value).toBe('function')
  })

  it('rejects non-function values', () => {
    const schema = fn.returns(z.number())
    const validation = schema['~standard'].validate(42)
    expect(validation).toHaveProperty('issues')
  })

  it('validates return value when function is called', () => {
    const schema = fn.returns(z.number())
    const validation = schema['~standard'].validate(() => 42)
    expect(validation).not.toHaveProperty('issues')
    const wrappedFn = (validation as any).value
    expect(wrappedFn()).toBe(42)
  })
})

describe('policy - sinks cannot accept functions or promises', () => {
  const sinkExo = new ExoAgent(['source'] as const, ['sink'] as const)

  class SinkToolset {
    @sinkExo.tool({ source: ['source'] })
    getSource() { return 'data' }

    @sinkExo.tool(z.any(), { sink: ['sink'] })
    writeSink(data: unknown) { return `wrote: ${data}` }

    @sinkExo.tool(z.any()) // no sink annotation
    noSink(data: unknown) { return `no sink: ${data}` }
  }

  it('rejects function argument to sink', () => {
    const toolset = new SinkToolset()
    const policy = sinkExo.policy([])

    const fnArg = Value.of(() => 'sneaky', [])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'writeSink', parent: Value.of(toolset, []) },
        Value.of(toolset.writeSink, []) as Value<(d: unknown) => string>,
        Value.of(toolset, []),
        [fnArg],
      )
    }).toThrow(/Sink cannot accept function/)
  })

  it('rejects promise argument to sink', () => {
    const toolset = new SinkToolset()
    const policy = sinkExo.policy([])

    const promiseArg = Value.of(Promise.resolve('sneaky'), [])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'writeSink', parent: Value.of(toolset, []) },
        Value.of(toolset.writeSink, []) as Value<(d: unknown) => string>,
        Value.of(toolset, []),
        [promiseArg],
      )
    }).toThrow(/Sink cannot accept promise/)
  })

  it('rejects function nested in array', () => {
    const toolset = new SinkToolset()
    const policy = sinkExo.policy([])

    const arrayWithFn = Value.of([Value.of(1, []), Value.of(() => 'sneaky', [])], [])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'writeSink', parent: Value.of(toolset, []) },
        Value.of(toolset.writeSink, []) as Value<(d: unknown) => string>,
        Value.of(toolset, []),
        [arrayWithFn],
      )
    }).toThrow(/Sink cannot accept function at arg0\[1\]/)
  })

  it('rejects function nested in object', () => {
    const toolset = new SinkToolset()
    const policy = sinkExo.policy([])

    const objWithFn = Value.of({ clean: Value.of('ok', []), bad: Value.of(() => 'sneaky', []) }, [])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'writeSink', parent: Value.of(toolset, []) },
        Value.of(toolset.writeSink, []) as Value<(d: unknown) => string>,
        Value.of(toolset, []),
        [objWithFn],
      )
    }).toThrow(/Sink cannot accept function at arg0.bad/)
  })

  it('rejects deeply nested function', () => {
    const toolset = new SinkToolset()
    const policy = sinkExo.policy([])

    const deepNested = Value.of({
      level1: Value.of({
        level2: Value.of([
          Value.of(() => 'deeply sneaky', []),
        ], []),
      }, []),
    }, [])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'writeSink', parent: Value.of(toolset, []) },
        Value.of(toolset.writeSink, []) as Value<(d: unknown) => string>,
        Value.of(toolset, []),
        [deepNested],
      )
    }).toThrow(/Sink cannot accept function at arg0.level1.level2\[0\]/)
  })

  it('allows function argument to non-sink method', () => {
    const toolset = new SinkToolset()
    const policy = sinkExo.policy([])

    const fnArg = Value.of(() => 'callback', [])

    const result = policy.doStubCall(
      { propertyName: 'noSink', parent: Value.of(toolset, []) },
      Value.of(toolset.noSink, []) as Value<(d: unknown) => string>,
      Value.of(toolset, []),
      [fnArg],
    )

    expect(result.raw).toContain('no sink')
  })

  it('allows primitive values to sink', () => {
    const toolset = new SinkToolset()
    const policy = sinkExo.policy([])

    const primitiveArg = Value.of('just a string', [])

    const result = policy.doStubCall(
      { propertyName: 'writeSink', parent: Value.of(toolset, []) },
      Value.of(toolset.writeSink, []) as Value<(d: unknown) => string>,
      Value.of(toolset, []),
      [primitiveArg],
    )

    expect(result.raw).toBe('wrote: just a string')
  })

  it('allows nested primitives to sink', () => {
    const toolset = new SinkToolset()
    const policy = sinkExo.policy([])

    const nestedPrimitives = Value.of({
      arr: Value.of([Value.of(1, []), Value.of(2, [])], []),
      obj: Value.of({ a: Value.of('hello', []) }, []),
    }, [])

    const result = policy.doStubCall(
      { propertyName: 'writeSink', parent: Value.of(toolset, []) },
      Value.of(toolset.writeSink, []) as Value<(d: unknown) => string>,
      Value.of(toolset, []),
      [nestedPrimitives],
    )

    expect(result.raw).toContain('wrote:')
  })
})

describe('policy - error messages', () => {
  it('provides clear error for missing method name', () => {
    const simpleExo = new ExoAgent([] as const, [] as const)
    const policy = simpleExo.policy([])

    expect(() => {
      policy.doStubCall(
        { parent: Value.of({}, []) }, // missing propertyName
        Value.of(() => {}, []) as Value<() => void>,
        Value.of({}, []),
        [],
      )
    }).toThrow(/must have a name/)
  })

  it('provides clear error for missing parent', () => {
    const simpleExo = new ExoAgent([] as const, [] as const)
    const policy = simpleExo.policy([])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'test' }, // missing parent
        Value.of(() => {}, []) as Value<() => void>,
        Value.of({}, []),
        [],
      )
    }).toThrow(/must have a name and parent/)
  })

  it('provides clear error for non-tool method', () => {
    const simpleExo = new ExoAgent([] as const, [] as const)

    class NoToolsClass {
      regularMethod() { return 'not a tool' }
    }

    const instance = new NoToolsClass()
    const policy = simpleExo.policy([])

    expect(() => {
      policy.doStubCall(
        { propertyName: 'regularMethod', parent: Value.of(instance, []) },
        Value.of(instance.regularMethod, []) as Value<() => string>,
        Value.of(instance, []),
        [],
      )
    }).toThrow(/does not have any @tool annotations/)
  })
})
