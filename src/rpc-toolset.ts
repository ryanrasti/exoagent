import type { StandardSchemaV1 } from '@standard-schema/spec'
import { RpcTarget } from 'capnweb'

const validate = (schema: StandardSchemaV1, value: unknown): void => {
  const validation = schema['~standard'].validate(value)
  if (validation instanceof Promise) {
    throw new TypeError(`Validation must be synchronous`)
  }
  if (validation.issues) {
    throw new Error(`Invalid value: ${validation.issues.map(e => e.message).join(', ')}`)
  }
}

const toolMetadataKey = Symbol('toolMetadata')
type ToolMetadata = {
  [toolMetadataKey]?: {
    runtimeValidationEnabled?: boolean
  }
}

// `@tool` is a decorator that annotates the input of a method
//   it is used for validation and typing
export function tool(): <This, Return>(
  target: (this: This) => Return,
  context: ClassMethodDecoratorContext<This, (this: This) => Return>,
) => (this: This) => Return
export function tool<TInput>(inputSchema: StandardSchemaV1<TInput, TInput>): <This, Return>(
  target: (this: This, arg: TInput) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, arg: TInput) => Return>,
) => (this: This, arg: TInput) => Return
export function tool<TInput = void>(inputSchema?: StandardSchemaV1<TInput, TInput>) {
  return <This, Return>(
    target: ((this: This) => Return) | ((this: This, arg: TInput) => Return),
    context: ClassMethodDecoratorContext<This, (...unknown: unknown[]) => Return>,
  ): any => {
    if (context.kind !== 'method') {
      throw new Error(`Tool decorator can only be used on methods`)
    }

    const methodName = String(context.name)

    const replacementMethod: (this: This, arg: TInput) => Return = function (this: This, ...args: [TInput, ...unknown[]]): Return {
      const expectedArgs = inputSchema ? 1 : 0
      if (args.length > expectedArgs) {
        throw new Error(`Tool ${methodName} got too many arguments: ${args.length} provided (expected ${expectedArgs})`)
      }
      if (inputSchema) {
        const arg = args[0]
        validate(inputSchema, arg)
        return (target as (this: This, arg: TInput) => Return).call(this, arg)
      }
      else {
        return (target as (this: This) => Return).call(this)
      }
    }

    const meta = replacementMethod as unknown as ToolMetadata
    meta[toolMetadataKey] = {
      ...meta[toolMetadataKey],
      runtimeValidationEnabled: true,
    }

    return replacementMethod
  }
}

// Special kind of `RpcTarget` that ensures all methods are tools (have the @tool decorator).
// This ensures that:
// 1. Only methods with the @tool decorator are exposed to the RPC layer.
// 2. All methods have input validation.
export class RpcToolset extends RpcTarget {
  constructor() {
    super()
    const prototype = Object.getPrototypeOf(this)
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === 'constructor') {
        continue
      }
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
      if (!descriptor?.value || typeof descriptor.value !== 'function') {
        throw new Error(`RpcToolset prototype must be methods: ${key} is not`)
      }
      const meta = descriptor.value as unknown as ToolMetadata
      if (!meta[toolMetadataKey]?.runtimeValidationEnabled) {
        throw new Error(`Prototype method ${key} is not a tool. Did you forget to use the @tool decorator?`)
      }
    }
  }
}
