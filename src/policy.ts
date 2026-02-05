import { Value } from 'capnweb-eval'
import { getToolMetadata } from './rpc-toolset'

export class Policy<Sources extends string[] = [], Sinks extends string[] = []> {
  constructor(private sources: Sources, private sinks: Sinks) {
  }

  private checkSourceTaintsConfigured(taints: string[]): void {
    const unconfigured = taints.filter(taint => !this.sources.includes(taint))
    if (unconfigured.length > 0) {
      throw new Error(`Source taint ${unconfigured.join(', ')} is not configured`)
    }
  }

  private checkSinkTaintsConfigured(taints: string[]): void {
    const unconfigured = taints.filter(taint => !this.sinks.includes(taint))
    if (unconfigured.length > 0) {
      throw new Error(`Sink taint ${unconfigured.join(', ')} is not configured`)
    }
  }

  doStubCall(method: Value<(...args: any[]) => any>, thisVal: Value, args: Value[]): Value {
    const annotation = getToolMetadata(method.raw)?.policyProps
    this.checkSinkTaintsConfigured(annotation?.sinks ?? [])
    this.checkSourceTaintsConfigured(annotation?.sources ?? [])

    const incomingTaints = Value.mergeTaints(thisVal, ...args)
    this.checkSourceTaintsConfigured(incomingTaints)

    const matchingSinks = incomingTaints.filter(taint => annotation?.sinks?.includes(taint))
    if (matchingSinks.length > 0) {
      throw new Error(`Method call denied: ${matchingSinks.join(', ')} are not allowed to be used as sinks`)
    }

    const result = method.callStub(thisVal, args)
    return Value.of(result, Value.mergeTaints(thisVal, ...args),
    ).withTaints(annotation?.sources ?? [])
  }
}
