import z from 'zod'
import { Value } from './eval'
import type { StandardSchemaV1 } from '@standard-schema/spec'

export type ToolProps<Sinks extends string[], Sources extends string[]> = { source?: [Sources[number]] | Sources[number], sink?: [Sinks[number]] | Sinks[number] }

type PolicyDenyRule = {
  sources: string[]
  sinks: string[]
}

class Policy<Sources extends string[] = [], Sinks extends string[] = []> {
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
    const meta = getToolMetadata(method.raw)
    if (meta == null) {
      throw new Error(`Method ${thisVal.raw}.${method.raw} is not a tool`)
    }

    const annotation = meta.policyProps

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

  tool<TInputs extends unknown[]>(...args: [...InputSchemas<TInputs>, ToolProps<Sinks, Sources>]): (target: (...args: TInputs) => any, context: ClassMethodDecoratorContext<any, (...args: TInputs) => any>) => any {
    return <This, Return>(
      target: (...args: TInputs) => Return,
      context: ClassMethodDecoratorContext<This, (...args: TInputs) => Return>,
    ): any => {
      if (context.kind !== 'method') {
        throw new Error(`Tool decorator can only be used on methods`)
      }
      if (typeof context.name !== 'string') {
        throw new Error(`Tool decorator can only be used on methods with a string name`)
      }
 
      const inputSchemas = args.slice(0, -1) as InputSchemas<TInputs>
      const toolProps = args[args.length - 1]
      validate(context.name, inputSchemas, args)

      return tool(...inputSchemas)(target, context)
    }
  }

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
        throw new TypeError(`Validation must be synchronous`)
      }
      if (validation.issues) {
        throw new Error(`Invalid value: ${validation.issues.map(e => e.message).join(', ')}`)
      }
      ret.push(validation.value)
    }
    }
    return ret

}

export class ExoAgent<Sources extends string[] , Sinks extends string[]> {
  constructor(private sources: readonly [...Sources], private sinks: readonly [...Sinks]) {
    
  }

  tool<TInputs extends unknown[]>(...inputSchemasAndProps: [...InputSchemas<TInputs>, ToolProps<Sinks, Sources>?]): MethodDecorator<TInputs> {
    return <This, Return>(
      target: (...args: TInputs) => Return,
      context: ClassMethodDecoratorContext<This, (...args: TInputs) => Return>,
    ): any => {
      if (context.kind !== 'method') {
        throw new Error(`Tool decorator can only be used on methods`)
      }
  
      const methodName = String(context.name)
      const inputSchemas = inputSchemasAndProps.slice(0, -1) as InputSchemas<TInputs>
      const toolProps = inputSchemasAndProps[inputSchemasAndProps.length - 1] as ToolProps<Sinks, Sources> | undefined
  
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

type InputSchemas<TInputs extends unknown[]> = { [k in keyof TInputs]: StandardSchemaV1<TInputs[k], TInputs[k]> }

type MethodDecorator<TInputs extends unknown[]> = <This, Return>(
  target: (...args: TInputs) => Return,
  context: ClassMethodDecoratorContext<This, (...args: TInputs) => Return>,
) => (this: This, ...args: TInputs) => Return;


const exo = new ExoAgent(['source1', 'source2'], ['sink1', 'sink2'])

export const fn = new class {
  returns<TInput>(returnValue: StandardSchemaV1<TInput, TInput>): StandardSchemaV1<(...args: any[]) => TInput> {
    return {
      ['~standard']: {
        version: 1,
        vendor: 'exo',
        types: {
          input: (undefined as unknown as (...args: any[]) => TInput),
          output: (undefined as unknown as (...args: any[]) => TInput),
        },
        validate: (value) => {
          if (typeof value !== 'function') {
            return { issues: [{ message: 'Return value must be a function' }] }
          }

          return {value: (...args: any[]) => {
            const ret = value(...args)
            const validation = returnValue['~standard'].validate(ret)
            if (validation instanceof Promise) {
                throw new TypeError(`Validation must be synchronous`)
              }
              if (validation.issues) {
                return { issues: [{ message: 'Return value must be a function' }] }
              }
              return validation.value
            }
          }
        }
      },
    }
  }
}

class Test {
  @exo.tool(z.number(), z.string(), fn.returns(z.string()), { source: 'source1' })
  foo(input: number, input2: string, input3: () => string) {
    return 'foo'
  }
}