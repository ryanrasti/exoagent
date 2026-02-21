import { describe, expect, it } from 'vitest'
import z from 'zod'
import { ArrayValue, safeEval, Value } from './eval'
import type { Taint } from './eval'
import { ExoAgent, fn, tool } from './policy'

// Helper to check if taints contain a specific taint type
const taintsContain = (taints: Taint[], type: string) =>
  taints.some(t => t[0] === type)

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

describe('TurnPolicy - cost limiting', () => {
  it('tracks cost and throws when max cost exceeded', () => {
    const toolset = new TestPolicyToolset()
    const turn = exo.policy([]).turn(2) // max 2 calls

    // First call - should work
    turn.doStubCall(
      { propertyName: 'source1', parent: Value.of(toolset, []) },
      Value.of(toolset.source1, []) as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [],
    )
    expect(turn.getCostUsed()).toBe(1)

    // Second call - should work
    turn.doStubCall(
      { propertyName: 'source2', parent: Value.of(toolset, []) },
      Value.of(toolset.source2, []) as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [],
    )
    expect(turn.getCostUsed()).toBe(2)

    // Third call - should throw
    expect(() => {
      turn.doStubCall(
        { propertyName: 'source1', parent: Value.of(toolset, []) },
        Value.of(toolset.source1, []) as Value<(...args: any[]) => any>,
        Value.of(toolset, []),
        [],
      )
    }).toThrow(/Exceeded max cost: 2/)
  })

  it('each turn has independent cost counter', () => {
    const toolset = new TestPolicyToolset()
    const policy = exo.policy([])

    // First turn
    const turn1 = policy.turn(1)
    turn1.doStubCall(
      { propertyName: 'source1', parent: Value.of(toolset, []) },
      Value.of(toolset.source1, []) as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [],
    )
    expect(turn1.getCostUsed()).toBe(1)

    // Second turn - fresh counter
    const turn2 = policy.turn(1)
    expect(turn2.getCostUsed()).toBe(0)
    turn2.doStubCall(
      { propertyName: 'source1', parent: Value.of(toolset, []) },
      Value.of(toolset.source1, []) as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [],
    )
    expect(turn2.getCostUsed()).toBe(1)
  })

  it('cost is checked before executing the method', () => {
    let callCount = 0
    class CountingToolset {
      @exo.tool()
      counted() {
        callCount++
        return 'called'
      }
    }

    const toolset = new CountingToolset()
    const turn = exo.policy([]).turn(1)

    // First call executes
    turn.doStubCall(
      { propertyName: 'counted', parent: Value.of(toolset, []) },
      Value.of(toolset.counted, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )
    expect(callCount).toBe(1)

    // Second call should throw before executing
    expect(() => {
      turn.doStubCall(
        { propertyName: 'counted', parent: Value.of(toolset, []) },
        Value.of(toolset.counted, []) as Value<() => string>,
        Value.of(toolset, []),
        [],
      )
    }).toThrow(/Exceeded max cost/)
    expect(callCount).toBe(1) // Still 1, method wasn't called
  })
})

describe('policy', () => {
  it('allows source1 -> sink flow (taint1 source to taint1 sink)', () => {
    const toolset = new TestPolicyToolset()
    const turn = exo.policy([
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ]).turn(10)

    // Call source1 which emits taint1
    const source1Method = Value.of(toolset.source1, [])
    const source1Result = turn.doStubCall(
      { propertyName: 'source1', parent: Value.of(toolset, []) },
      source1Method as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [],
    )

    // Verify source1 result has taint1
    expect(taintsContain(source1Result.getTaints(), 'taint1')).toBe(true)
    expect(source1Result.raw).toBe('data from source1')

    // Call sink with taint1 data - should pass
    const sinkMethod = Value.of(toolset.sink, [])
    const sinkArg = Value.of('data from source1', source1Result.getTaints())
    const sinkResult = turn.doStubCall(
      { propertyName: 'sink', parent: Value.of(toolset, []) },
      sinkMethod as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [sinkArg],
    )

    expect(sinkResult.raw).toBe('sink received: data from source1')
  })

  it('denies source2 -> sink flow (taint2 source to taint1 sink)', () => {
    const toolset = new TestPolicyToolset()
    const turn = exo.policy([
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ]).turn(10)

    // Call source2 which emits taint2
    const source2Method = Value.of(toolset.source2, [])
    const source2Result = turn.doStubCall(
      { propertyName: 'source2', parent: Value.of(toolset, []) },
      source2Method as Value<(...args: any[]) => any>,
      Value.of(toolset, []),
      [],
    )

    // Verify source2 result has taint2
    expect(taintsContain(source2Result.getTaints(), 'taint2')).toBe(true)
    expect(source2Result.raw).toBe('data from source2')

    // Call sink with taint2 data - should be denied by deny rule
    const sinkMethod = Value.of(toolset.sink, [])
    const sinkArg = Value.of('data from source2', source2Result.getTaints())
    expect(() => {
      turn.doStubCall(
        { propertyName: 'sink', parent: Value.of(toolset, []) },
        sinkMethod as Value<(...args: any[]) => any>,
        Value.of(toolset, []),
        [sinkArg],
      )
    }).toThrow('Method call denied: taint2 are not allowed to be used as sources and taint1 are not allowed to be used as sinks')
  })

  it('allows source1 -> sink flow end-to-end through evaluator', async () => {
    const toolset = new TestPolicyToolset()
    const turn = exo.policy([
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ]).turn(10)

    // Evaluate code that calls source1 then sink
    // Pass toolset directly as RpcStub (RpcToolset extends RpcTarget which can be wrapped in RpcStub)
    const result = safeEval(
      'sink(source1())',
      Value.of(toolset, []),
      turn.doStubCall.bind(turn),
    ) as Value<string>

    expect(result.raw).toBe('sink received: data from source1')
  })

  it('denies source2 -> sink flow end-to-end through evaluator', async () => {
    const toolset = new TestPolicyToolset()
    const turn = exo.policy([
      { sources: ['taint2'], sinks: ['taint1'] }, // deny rule: taint2 source cannot go to taint1 sink
    ]).turn(10)

    // Evaluate code that calls source2 then sink - should be denied
    // Pass toolset directly as RpcStub (RpcToolset extends RpcTarget which can be wrapped in RpcStub)
    expect(
      () => safeEval(
        'sink(source2())',
        Value.of(toolset, []),
        turn.doStubCall.bind(turn),
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
    const turn = multiExo.policy([
      { sources: ['userInput'], sinks: ['database'] },
      { sources: ['networkData'], sinks: ['fileSystem'] },
    ]).turn(10)

    // userInput -> database: DENIED
    const userInput = turn.doStubCall(
      { propertyName: 'getUserInput', parent: Value.of(toolset, []) },
      Value.of(toolset.getUserInput, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )
    expect(() => {
      turn.doStubCall(
        { propertyName: 'writeToDb', parent: Value.of(toolset, []) },
        Value.of(toolset.writeToDb, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [userInput],
      )
    }).toThrow(/Method call denied/)

    // userInput -> fileSystem: ALLOWED
    const fileResult = turn.doStubCall(
      { propertyName: 'writeToFile', parent: Value.of(toolset, []) },
      Value.of(toolset.writeToFile, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [userInput],
    )
    expect(fileResult.raw).toBe('file: user data')

    // networkData -> fileSystem: DENIED
    const networkData = turn.doStubCall(
      { propertyName: 'getNetworkData', parent: Value.of(toolset, []) },
      Value.of(toolset.getNetworkData, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )
    expect(() => {
      turn.doStubCall(
        { propertyName: 'writeToFile', parent: Value.of(toolset, []) },
        Value.of(toolset.writeToFile, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [networkData],
      )
    }).toThrow(/Method call denied/)

    // networkData -> database: ALLOWED
    const dbResult = turn.doStubCall(
      { propertyName: 'writeToDb', parent: Value.of(toolset, []) },
      Value.of(toolset.writeToDb, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [networkData],
    )
    expect(dbResult.raw).toBe('db: network data')
  })

  it('handles overlapping deny rules', () => {
    const toolset = new MultiSourceToolset()
    const turn = multiExo.policy([
      { sources: ['userInput'], sinks: ['database'] },
      { sources: ['userInput'], sinks: ['network'] }, // overlapping source
    ]).turn(10)

    const userInput = turn.doStubCall(
      { propertyName: 'getUserInput', parent: Value.of(toolset, []) },
      Value.of(toolset.getUserInput, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )

    // Both sinks should be denied
    expect(() => {
      turn.doStubCall(
        { propertyName: 'writeToDb', parent: Value.of(toolset, []) },
        Value.of(toolset.writeToDb, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [userInput],
      )
    }).toThrow(/Method call denied/)

    expect(() => {
      turn.doStubCall(
        { propertyName: 'sendToNetwork', parent: Value.of(toolset, []) },
        Value.of(toolset.sendToNetwork, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [userInput],
      )
    }).toThrow(/Method call denied/)

    // fileSystem should be allowed
    const fileResult = turn.doStubCall(
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
    const turn = multiExo.policy([]).turn(10)

    const result = turn.doStubCall(
      { propertyName: 'dualSource', parent: Value.of(toolset, []) },
      Value.of(toolset.dualSource, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )

    expect(taintsContain(result.getTaints(), 'source1')).toBe(true)
    expect(taintsContain(result.getTaints(), 'source2')).toBe(true)
  })

  it('tool with multiple sinks is denied if any sink matches deny rule', () => {
    const toolset = new MultiAnnotationToolset()
    const turn = multiExo.policy([
      { sources: ['source3'], sinks: ['sink1'] }, // Only denies sink1, but dualSink has both
    ]).turn(10)

    const sourceData = turn.doStubCall(
      { propertyName: 'singleSource', parent: Value.of(toolset, []) },
      Value.of(toolset.singleSource, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )

    expect(() => {
      turn.doStubCall(
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
    const turn = chainExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ]).turn(10)

    // Get untrusted data
    const untrusted = turn.doStubCall(
      { propertyName: 'getUntrusted', parent: Value.of(toolset, []) },
      Value.of(toolset.getUntrusted, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )

    // Transform it (should preserve taint)
    const transformed = turn.doStubCall(
      { propertyName: 'transform', parent: Value.of(toolset, []) },
      Value.of(toolset.transform, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [untrusted],
    )
    expect(taintsContain(transformed.getTaints(), 'untrusted')).toBe(true)

    // Should still be denied at sensitive sink
    expect(() => {
      turn.doStubCall(
        { propertyName: 'writeSensitive', parent: Value.of(toolset, []) },
        Value.of(toolset.writeSensitive, []) as Value<(s: string) => string>,
        Value.of(toolset, []),
        [transformed],
      )
    }).toThrow(/Method call denied/)
  })

  it('trusted data passes through chain to sensitive sink', () => {
    const toolset = new ChainToolset()
    const turn = chainExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ]).turn(10)

    const trusted = turn.doStubCall(
      { propertyName: 'getTrusted', parent: Value.of(toolset, []) },
      Value.of(toolset.getTrusted, []) as Value<() => string>,
      Value.of(toolset, []),
      [],
    )

    const transformed = turn.doStubCall(
      { propertyName: 'transform', parent: Value.of(toolset, []) },
      Value.of(toolset.transform, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [trusted],
    )

    const result = turn.doStubCall(
      { propertyName: 'writeSensitive', parent: Value.of(toolset, []) },
      Value.of(toolset.writeSensitive, []) as Value<(s: string) => string>,
      Value.of(toolset, []),
      [transformed],
    )
    expect(result.raw).toBe('sensitive: transformed: trusted data')
  })

  it('chained calls work through evaluator', () => {
    const toolset = new ChainToolset()
    const turn = chainExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ]).turn(10)

    // Trusted chain should work
    const result = safeEval(
      'writeSensitive(transform(getTrusted()))',
      Value.of(toolset, []),
      turn.doStubCall.bind(turn),
    ) as Value<string>
    expect(result.raw).toBe('sensitive: transformed: trusted data')

    // Untrusted chain should fail (need fresh turn since we share cost counter)
    const turn2 = chainExo.policy([
      { sources: ['untrusted'], sinks: ['sensitive'] },
    ]).turn(10)
    expect(() => safeEval(
      'writeSensitive(transform(getUntrusted()))',
      Value.of(toolset, []),
      turn2.doStubCall.bind(turn2),
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
    const turn = thisExo.policy([
      { sources: ['objectTaint'], sinks: ['sink'] },
    ]).turn(10)

    const taintedThis = Value.of(toolset, ['objectTaint'])
    const cleanArg = Value.of('clean data', [])

    expect(() => {
      turn.doStubCall(
        { propertyName: 'process', parent: taintedThis },
        Value.of(toolset.process, []) as Value<(s: string) => string>,
        taintedThis,
        [cleanArg],
      )
    }).toThrow(/Method call denied/)
  })

  it('checks taints from args', () => {
    const toolset = new ThisToolset()
    const turn = thisExo.policy([
      { sources: ['argTaint'], sinks: ['sink'] },
    ]).turn(10)

    const cleanThis = Value.of(toolset, [])
    const taintedArg = Value.of('tainted data', ['argTaint'])

    expect(() => {
      turn.doStubCall(
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
    const turn = limitedExo.policy([]).turn(10)

    expect(() => {
      turn.doStubCall(
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
    const turn = limitedExo.policy([]).turn(10)

    expect(() => {
      turn.doStubCall(
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
    const turn = limitedExo.policy([]).turn(10)

    // Create a value with an unconfigured taint (simulating a bug or external data)
    const badTaintedArg = Value.of('data', ['sneakyTaint'])

    expect(() => {
      turn.doStubCall(
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
    expect(() => toolset.requiresNumber('not a number' as any)).toThrow(/requiresNumber validation failed/)
  })

  it('validates multiple inputs', () => {
    class MultiValidatedToolset {
      @tool(z.string(), z.number())
      concat(s: string, n: number) { return s + n }
    }

    const toolset = new MultiValidatedToolset()
    expect(toolset.concat('value:', 42)).toBe('value:42')
    expect(() => toolset.concat(123 as any, 42)).toThrow(/concat validation failed/)
    expect(() => toolset.concat('value:', 'not a number' as any)).toThrow(/concat validation failed/)
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
    expect(() => toolset.processUser({ name: 'Bob', age: -5 })).toThrow(/processUser validation failed/)
    expect(() => toolset.processUser({ name: 123 as any, age: 30 })).toThrow(/processUser validation failed/)
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

describe('policy - ArrayValue builtin methods', () => {
  const arrayExo = new ExoAgent(['data'] as const, [] as const)

  it('ArrayValue has @builtin metadata (not @tool)', () => {
    // ArrayValue methods are builtins that bypass doStubCall
    // and are called directly with Value-wrapped args
    const arr = Value.of([1, 2, 3], [['data', {}]])
    expect(arr).toBeInstanceOf(ArrayValue)

    // Get the map method via getSlot - it should have builtinFunction: true
    const mapMethod = arr.getSlot(Value.of('map', []))
    expect(mapMethod.options.builtinFunction).toBe(true)
  })

  it('works through evaluator with safeEval', () => {
    const turn = arrayExo.policy([]).turn(10)

    const scope = Value.of({ arr: [1, 2, 3] }, [['data', {}]])
    const result = safeEval(
      'arr.map(x => x * 2)',
      scope,
      turn.doStubCall.bind(turn),
    )

    expect(result.raw.map((v: Value) => v.raw)).toEqual([2, 4, 6])
    expect(result.getTaints().some(([type]) => type === 'data')).toBe(true)
  })
})

describe('policy - error messages', () => {
  it('provides clear error for missing method name', () => {
    const simpleExo = new ExoAgent([] as const, [] as const)
    const turn = simpleExo.policy([]).turn(10)

    expect(() => {
      turn.doStubCall(
        { parent: Value.of({}, []) }, // missing propertyName
        Value.of(() => {}, []) as Value<() => void>,
        Value.of({}, []),
        [],
      )
    }).toThrow(/must have a name/)
  })

  it('provides clear error for missing parent', () => {
    const simpleExo = new ExoAgent([] as const, [] as const)
    const turn = simpleExo.policy([]).turn(10)

    expect(() => {
      turn.doStubCall(
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
    const turn = simpleExo.policy([]).turn(10)

    expect(() => {
      turn.doStubCall(
        { propertyName: 'regularMethod', parent: Value.of(instance, []) },
        Value.of(instance.regularMethod, []) as Value<() => string>,
        Value.of(instance, []),
        [],
      )
    }).toThrow(/does not have any @tool annotations/)
  })
})

describe('policy - dynamic annotations (email example)', () => {
  const emailExo = new ExoAgent(['email'] as const, ['email'] as const)

  // Email type for testing
  type Email = {
    id: string
    from: string
    to: string[]
    cc: string[]
    bcc: string[]
    subject: string
    body: string
  }

  class EmailToolset {
    // Dynamic source: annotate with principals from email headers
    @emailExo.tool(z.string(), {
      source: (email: Email) => [
        'email',
        { principals: [email.from, ...email.to, ...email.cc, ...email.bcc] },
      ],
    })
    getEmail(id: string): Email {
      // Mock email data
      return {
        id,
        from: 'alice@example.com',
        to: ['bob@example.com'],
        cc: ['charlie@example.com'],
        bcc: [],
        subject: 'Test',
        body: 'Hello',
      }
    }

    // Dynamic sink: annotate with recipients
    @emailExo.tool(
      z.object({
        to: z.array(z.string()),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        subject: z.string(),
        body: z.string(),
      }),
      {
        sink: ({ to, cc, bcc }: { to: string[], cc?: string[], bcc?: string[] }) => [
          'email',
          { principals: [...to, ...(cc ?? []), ...(bcc ?? [])] },
        ],
      },
    )
    sendEmail(opts: { to: string[], cc?: string[], bcc?: string[], subject: string, body: string }) {
      return `sent to ${opts.to.join(', ')}`
    }
  }

  // Helper: check if all recipients are in allowed principals
  const isSubset = (recipients: string[], allowed: string[]) =>
    recipients.every(r => allowed.includes(r))

  it('allows sending email to original recipients (principals subset)', () => {
    const toolset = new EmailToolset()
    const turn = emailExo.policy([
      // Callback deny rule: deny if recipients are not subset of source principals
      (source, sink) => {
        if (source[0] !== 'email' || sink[0] !== 'email') return 'allow'
        const allowed = source[1].principals ?? []
        const recipients = sink[1].principals ?? []
        return isSubset(recipients, allowed) ? 'allow' : 'deny'
      },
    ]).turn(10)

    // Get email from alice to bob (cc: charlie)
    const emailResult = turn.doStubCall(
      { propertyName: 'getEmail', parent: Value.of(toolset, []) },
      Value.of(toolset.getEmail, []) as Value<(id: string) => Email>,
      Value.of(toolset, []),
      [Value.of('123', [])],
    )

    // Verify email has correct principals
    const emailTaint = emailResult.getTaints().find(([type]) => type === 'email')
    expect(emailTaint).toBeDefined()
    expect(emailTaint![1].principals).toContain('alice@example.com')
    expect(emailTaint![1].principals).toContain('bob@example.com')
    expect(emailTaint![1].principals).toContain('charlie@example.com')

    // Send to bob only - should be allowed (bob is in principals)
    const sendResult = turn.doStubCall(
      { propertyName: 'sendEmail', parent: Value.of(toolset, []) },
      Value.of(toolset.sendEmail, []) as Value<(opts: any) => string>,
      Value.of(toolset, []),
      [Value.of({ to: ['bob@example.com'], subject: 'Re: Test', body: 'Reply' }, emailResult.getTaints())],
    )

    expect(sendResult.raw).toBe('sent to bob@example.com')
  })

  it('denies sending email to unauthorized recipients', () => {
    const toolset = new EmailToolset()
    const turn = emailExo.policy([
      (source, sink) => {
        if (source[0] !== 'email' || sink[0] !== 'email') return 'allow'
        const allowed = source[1].principals ?? []
        const recipients = sink[1].principals ?? []
        return isSubset(recipients, allowed) ? 'allow' : 'deny'
      },
    ]).turn(10)

    // Get email from alice to bob
    const emailResult = turn.doStubCall(
      { propertyName: 'getEmail', parent: Value.of(toolset, []) },
      Value.of(toolset.getEmail, []) as Value<(id: string) => Email>,
      Value.of(toolset, []),
      [Value.of('123', [])],
    )

    // Try to send to eve - should be denied (eve not in principals)
    expect(() => {
      turn.doStubCall(
        { propertyName: 'sendEmail', parent: Value.of(toolset, []) },
        Value.of(toolset.sendEmail, []) as Value<(opts: any) => string>,
        Value.of(toolset, []),
        [Value.of({ to: ['eve@example.com'], subject: 'Forwarded', body: 'Secret' }, emailResult.getTaints())],
      )
    }).toThrow(/Method call denied/)
  })

  it('denies when any recipient is unauthorized', () => {
    const toolset = new EmailToolset()
    const turn = emailExo.policy([
      (source, sink) => {
        if (source[0] !== 'email' || sink[0] !== 'email') return 'allow'
        const allowed = source[1].principals ?? []
        const recipients = sink[1].principals ?? []
        return isSubset(recipients, allowed) ? 'allow' : 'deny'
      },
    ]).turn(10)

    const emailResult = turn.doStubCall(
      { propertyName: 'getEmail', parent: Value.of(toolset, []) },
      Value.of(toolset.getEmail, []) as Value<(id: string) => Email>,
      Value.of(toolset, []),
      [Value.of('123', [])],
    )

    // Try to send to bob AND eve - should be denied (eve not in principals)
    expect(() => {
      turn.doStubCall(
        { propertyName: 'sendEmail', parent: Value.of(toolset, []) },
        Value.of(toolset.sendEmail, []) as Value<(opts: any) => string>,
        Value.of(toolset, []),
        [Value.of({ to: ['bob@example.com', 'eve@example.com'], subject: 'FW', body: 'Hey' }, emailResult.getTaints())],
      )
    }).toThrow(/Method call denied/)
  })

  it('allows sending to all original recipients (to, cc, bcc)', () => {
    const toolset = new EmailToolset()
    const turn = emailExo.policy([
      (source, sink) => {
        if (source[0] !== 'email' || sink[0] !== 'email') return 'allow'
        const allowed = source[1].principals ?? []
        const recipients = sink[1].principals ?? []
        return isSubset(recipients, allowed) ? 'allow' : 'deny'
      },
    ]).turn(10)

    const emailResult = turn.doStubCall(
      { propertyName: 'getEmail', parent: Value.of(toolset, []) },
      Value.of(toolset.getEmail, []) as Value<(id: string) => Email>,
      Value.of(toolset, []),
      [Value.of('123', [])],
    )

    // Send to all original recipients - should be allowed
    const sendResult = turn.doStubCall(
      { propertyName: 'sendEmail', parent: Value.of(toolset, []) },
      Value.of(toolset.sendEmail, []) as Value<(opts: any) => string>,
      Value.of(toolset, []),
      [Value.of({
        to: ['alice@example.com', 'bob@example.com'],
        cc: ['charlie@example.com'],
        subject: 'Reply All',
        body: 'Thanks',
      }, emailResult.getTaints())],
    )

    expect(sendResult.raw).toBe('sent to alice@example.com, bob@example.com')
  })
})
