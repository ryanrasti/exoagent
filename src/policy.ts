import { Value } from 'capnweb-eval'
import { getToolMetadata } from './rpc-toolset'

type PolicyDenyRule = {
  sources: string[]
  sinks: string[]
}

export class Policy<Sources extends string[] = [], Sinks extends string[] = []> {
  constructor(private sources: Sources, private sinks: Sinks, private denyRules: PolicyDenyRule[] = []) {
  }

  private checkSourceTaintsConfigured(taints: string[]): asserts taints is Sources {
    const unconfigured = taints.filter(taint => !this.sources.includes(taint))
    if (unconfigured.length > 0) {
      throw new Error(`Source taint ${unconfigured.join(', ')} is not configured`)
    }
  }

  private checkSinkTaintsConfigured(taints: string[]): asserts taints is Sinks {
    const unconfigured = taints.filter(taint => !this.sinks.includes(taint))
    if (unconfigured.length > 0) {
      throw new Error(`Sink taint ${unconfigured.join(', ')} is not configured`)
    }
  }

  private checkDenyRules(incomingTaints: Sources, sinks: Sinks): void {
    for (const denyRule of this.denyRules) {
      if (denyRule.sources.some(source => incomingTaints.includes(source)) && denyRule.sinks.some(sink => sinks.includes(sink))) {
        throw new Error(`Method call denied: ${denyRule.sources.join(', ')} are not allowed to be used as sources and ${denyRule.sinks.join(', ')} are not allowed to be used as sinks`)
      }
    }
  }

  doStubCall(method: Value<(...args: any[]) => any>, thisVal: Value, args: Value[]): Value {
    const annotation = getToolMetadata(method.raw)?.policyProps

    const sinks = annotation?.sinks ?? []
    const sources = annotation?.sources ?? []
    this.checkSinkTaintsConfigured(sinks)
    this.checkSourceTaintsConfigured(sources)

    const incomingTaints = Value.mergeTaints(thisVal, ...args)
    this.checkSourceTaintsConfigured(incomingTaints)
    this.checkDenyRules(incomingTaints, sinks)

    const result = method.callStub(thisVal, args)
    console.log('result', result)
    return result.withTaints([...Value.mergeTaints(thisVal, ...args), ...sources])
  }
}
