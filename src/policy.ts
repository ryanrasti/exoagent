import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Taint, ValueOptions } from './eval/utils'
import z from 'zod'
import { Value } from './eval'
import { getPolicyMetadata, setPolicyMetadata } from './meta'

export type ToolProps<Sinks extends string[], Sources extends string[]> = { source?: Sources[number] | readonly Sources[number][], sink?: Sinks[number] | readonly Sinks[number][] }

const flattenArray = <T>(array: T | readonly T[]): T[] => {
  return Array.isArray(array) ? array : [array as T]
}

const validate = <Inputs extends unknown[]>(methodName: string, inputSchemas: InputSchemas<Inputs>, values: unknown[]): Inputs => {
  const expectedArgs = inputSchemas.length
  if (values.length > expectedArgs) {
    throw new Error(`Tool ${methodName} got too many arguments: ${values.length} provided (expected ${expectedArgs})`)
  }
  const ret = []
  for (let i = 0; i < values.length; i++) {
    if ('~standard' in inputSchemas[i]) {
      const validation = inputSchemas[i]['~standard'].validate(values[i])
      if (validation instanceof Promise) {
        throw new TypeError(`Validation must be synchronous: ${validation} ${values[i]}`)
      }
      if (validation.issues) {
        throw new Error(`Invalid value: ${validation.issues.map(e => e.message).join(', ')}`)
      }
      ret.push(validation.value)
    }
  }
  return ret as Inputs
}

type PolicyDenyRule = {
  sources: string[]
  sinks: string[]
}

export class Policy<Sources extends readonly string[] = [], Sinks extends readonly string[] = []> {
  constructor(private sources: Sources, private sinks: Sinks, private denyRules: PolicyDenyRule[] = []) {
  }

  /** Check that source taint types (from tool annotations) are configured */
  private checkSourceTypesConfigured(types: readonly string[]): void {
    const unconfigured = types.filter(type => !this.sources.includes(type))
    if (unconfigured.length > 0) {
      throw new Error(`Source taint ${unconfigured.join(', ')} is not configured`)
    }
  }

  /** Check that incoming taints (Taint tuples) have configured source types */
  private checkIncomingTaintsConfigured(taints: readonly Taint[]): void {
    const unconfigured = taints.filter(([type]) => !this.sources.includes(type)).map(([type]) => type)
    if (unconfigured.length > 0) {
      throw new Error(`Source taint ${unconfigured.join(', ')} is not configured`)
    }
  }

  private checkSinkTaintsConfigured(taints: readonly string[]): asserts taints is Sinks {
    const unconfigured = taints.filter(taint => !this.sinks.includes(taint))
    if (unconfigured.length > 0) {
      throw new Error(`Sink taint ${unconfigured.join(', ')} is not configured`)
    }
  }

  private checkDenyRules(incomingTaints: readonly Taint[], sinks: Sinks): void {
    for (const denyRule of this.denyRules) {
      const hasMatchingSource = denyRule.sources.some(source => incomingTaints.some(([type]) => type === source))
      const hasMatchingSink = denyRule.sinks.some(sink => sinks.includes(sink))
      if (hasMatchingSource && hasMatchingSink) {
        throw new Error(`Method call denied: ${denyRule.sources.join(', ')} are not allowed to be used as sources and ${denyRule.sinks.join(', ')} are not allowed to be used as sinks`)
      }
    }
  }

  /**
   * Creates a policy checker for use with Value.unwrap().
   * Checks that the given taints don't violate any deny rules for the specified sink.
   * @param sink - The sink(s) to check against (e.g., 'output' for sandbox boundary)
   */
  createUnwrapChecker(sink: Sinks[number] | readonly Sinks[number][]): (taints: readonly Taint[], path: string) => void {
    const sinks = flattenArray(sink)
    this.checkSinkTaintsConfigured(sinks)

    return (taints: readonly Taint[], path: string) => {
      this.checkIncomingTaintsConfigured(taints)
      for (const denyRule of this.denyRules) {
        const hasMatchingSource = denyRule.sources.some(source => taints.some(([type]) => type === source))
        const hasMatchingSink = denyRule.sinks.some(s => sinks.includes(s))
        if (hasMatchingSource && hasMatchingSink) {
          const taintTypes = taints.map(([type]) => type)
          throw new Error(`Policy violation at ${path}: taints [${taintTypes.join(', ')}] cannot flow to sink [${sinks.join(', ')}]`)
        }
      }
    }
  }

  doStubCall(options: ValueOptions, method: Value<(...args: any[]) => any>, thisVal: Value, args: Value[]): Value {
    if (!options.propertyName || !options.parent) {
      throw new Error(`Method must have a name and parent`)
    }

    const meta = getPolicyMetadata(options.parent.raw as object)
    if (!meta) {
      throw new Error(`Method ${options.propertyName} does not have any @tool annotations: ${options.parent.raw}`)
    }
    const toolProps = meta[options.propertyName]
    if (!toolProps) {
      throw new Error(`Method ${thisVal.raw}.${method.raw} is not a tool`)
    }
    const sinks = flattenArray(toolProps.sink ?? [])
    const sources = flattenArray(toolProps.source ?? [])
    this.checkSinkTaintsConfigured(sinks)
    this.checkSourceTypesConfigured(sources)

    const incomingTaints = Value.mergeTaints(thisVal, ...args)
    this.checkIncomingTaintsConfigured(incomingTaints)
    this.checkDenyRules(incomingTaints, sinks)

    // Unwrap args with policy check against this tool's sinks
    const checker = sinks.length > 0 ? this.createUnwrapChecker(sinks) : () => {}
    const unwrappedArgs = args.map(a => a.unwrap(checker))
    const rawResult = Reflect.apply(method.raw, thisVal.raw, unwrappedArgs)
    const result = Value.of(rawResult, Value.mergeTaints(thisVal, ...args))
    return result.withTaints([...Value.mergeTaints(thisVal, ...args), ...sources])
  }
}

export class ExoAgent<Sources extends string[], Sinks extends string[]> {
  public readonly sources: Sources
  public readonly sinks: Sinks
  constructor(sources: readonly [...Sources], sinks: readonly [...Sinks]) {
    this.sources = sources as Sources
    this.sinks = sinks as Sinks
  }

  tool<TInputs extends unknown[]>(...inputSchemasAndProps: [...InputSchemas<TInputs>]): MethodDecorator<TInputs>
  tool<TInputs extends unknown[]>(...inputSchemasAndProps: [...InputSchemas<TInputs>, ToolProps<Sinks, Sources>]): MethodDecorator<TInputs>
  tool<TInputs extends unknown[]>(...inputSchemasAndProps: [...InputSchemas<TInputs>, ToolProps<Sinks, Sources>?]): MethodDecorator<TInputs> {
    return <This, Return>(
      target: (...args: TInputs) => Return,
      context: ClassMethodDecoratorContext<This, (...args: TInputs) => Return>,
    ): any => {
      if (context.kind !== 'method') {
        throw new Error(`Tool decorator can only be used on methods`)
      }
      const methodName = context.name
      if (typeof methodName !== 'string') {
        throw new TypeError(`Tool decorator can only be used on methods with a string name`)
      }

      const last = inputSchemasAndProps[inputSchemasAndProps.length - 1]
      const hasToolProps = last != null && !('~standard' in last)

      const inputSchemas = (hasToolProps ? inputSchemasAndProps.slice(0, -1) : inputSchemasAndProps) as InputSchemas<TInputs>
      const toolProps = (hasToolProps ? inputSchemasAndProps[inputSchemasAndProps.length - 1] : undefined) as ToolProps<Sinks, Sources> | undefined

      context.addInitializer(function (this: This) {
        const metadata = getPolicyMetadata(this as object)
        setPolicyMetadata(this as object, {
          ...metadata,
          [methodName]: toolProps ?? {},
        })
      })

      return function (this: This, ...args: TInputs): Return {
        const validatedArgs = validate(methodName, inputSchemas, args)
        return target.call(this, ...validatedArgs)
      }
    }
  }

  policy(denyRules: PolicyDenyRule[]): Policy<Sources, Sinks> {
    return new Policy(this.sources, this.sinks, denyRules)
  }
}

const _exo = new ExoAgent([], [])
export const tool: <TInputs extends any[]>(...inputSchemasAndProps: [...InputSchemas<TInputs>]) => MethodDecorator<TInputs> = _exo.tool.bind(_exo)

type InputSchemas<TInputs extends unknown[]> = { [k in keyof TInputs]: StandardSchemaV1<TInputs[k], TInputs[k]> }

type MethodDecorator<TInputs extends any[]> = <This>(
  target: (...args: TInputs) => any,
  context: ClassMethodDecoratorContext<This, (...args: TInputs) => any>,
) => (this: This, ...args: TInputs) => any

class ValidateFn {
  constructor(private optional: boolean = false) {}

  private validate(returnValue: StandardSchemaV1<any, any>, value: unknown) {
    if (typeof value !== 'function') {
      return { issues: [{ message: 'Return value must be a function' }] }
    }

    return { value: (...args: any[]) => {
      const ret = value(...args)
      const validation = returnValue['~standard'].validate(ret)
      if (validation instanceof Promise) {
        throw new TypeError(`Validation must be synchronous`)
      }
      if (validation.issues) {
        return { issues: [{ message: 'Return value must be a function' }] }
      }
      return validation.value
    } }
  }

  returns<TInput>(returnValue: StandardSchemaV1<TInput, TInput>): StandardSchemaV1<(...args: any[]) => TInput> & { optional: () => StandardSchemaV1<(...args: any[]) => TInput> } {
    const self = this
    return {
      '~standard': {
        version: 1,
        vendor: 'exo',
        types: {
          input: (undefined as unknown as (...args: any[]) => TInput),
          output: (undefined as unknown as (...args: any[]) => TInput),
        },
        validate: value => self.validate(returnValue, value),
      },
      'optional': () => { return new ValidateFn(true).returns(returnValue) },
    }
  }
}

export const fn = new ValidateFn()
