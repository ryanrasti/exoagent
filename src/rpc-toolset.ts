import type { StandardSchemaV1 } from '@standard-schema/spec'
import { inspect } from 'node:util'
import { RpcTarget } from 'capnweb'
import { RpcPromise } from 'capnweb'

const validate = (schema: StandardSchemaV1 | ((arg: unknown) => boolean), value: unknown): void => {
  if ('~standard' in schema) {
    const validation = schema['~standard'].validate(value)
    if (validation instanceof Promise) {
      throw new TypeError(`Validation must be synchronous`)
    }
    if (validation.issues) {
      throw new Error(`Invalid value: ${validation.issues.map(e => e.message).join(', ')}`)
    }
  }
  else {
    if (!schema(value)) {
      throw new Error(`Invalid value: ${inspect(value)} (expected ${schema.name || schema.toString()})`)
    }
  }
}

const toolMetadataKey = Symbol('toolMetadata')
type ToolMetadata = {
  [toolMetadataKey]?: {
    runtimeValidationEnabled?: boolean
  }
}
export const setToolMetadata = (target: (...args: any[]) => unknown, metadata: ToolMetadata[typeof toolMetadataKey]) => {
  const meta = target as unknown as ToolMetadata
  meta[toolMetadataKey] = {
    ...meta[toolMetadataKey],
    ...metadata,
  }
}

// `@tool` is a decorator that annotates the input of a method
//   it is used for validation and typing
function toolDef(): <This, Return>(
  target: (this: This) => Return,
  context: ClassMethodDecoratorContext<This, (this: This) => Return>,
) => (this: This) => Return
function toolDef<TInput>(inputSchema: StandardSchemaV1<TInput, TInput>): <This, Return>(
  target: (this: This, arg: TInput) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, arg: TInput) => Return>,
) => (this: This, arg: TInput) => Return
function toolDef<TInput = void>(inputSchema?: StandardSchemaV1<TInput, TInput>) {
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

    setToolMetadata(replacementMethod, { runtimeValidationEnabled: true })

    return replacementMethod
  }
}

function toolUnsafeNoValidation() {
  return <This, Return>(
    target: (this: This, ...args: any[]) => Return,
    context: ClassMethodDecoratorContext<This, (...unknown: any[]) => Return>,
  ): any => {
    if (context.kind !== 'method') {
      throw new Error(`Tool decorator can only be used on methods`)
    }

    setToolMetadata(target, { runtimeValidationEnabled: true })

    return target
  }
}

const callbackMetadataKey = Symbol('callbackMetadata')
export type ToolCallback<T extends (arg: any) => unknown> = T | { [callbackMetadataKey]: {
  callback: T
} }

type Fn = ToolCallback<(arg: any) => any>

function callbackTool(
): <This, Return>(
  target: (this: This, arg: Fn) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, arg: Fn) => Return>,
) => (this: This, arg: Fn) => Return {
  return <This, Return>(
    target: (this: This, arg: Fn) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, arg: Fn) => Return>,
  ): any => {
    if (context.kind !== 'method') {
      throw new Error(`Tool decorator can only be used on methods`)
    }

    const methodName = String(context.name)

    const replacementMethod: (this: This, arg: Fn) => Return = function (this: This, ...args: [Fn, ...unknown[]]): Return {
      if (args.length !== 1) {
        throw new Error(`Tool ${methodName} got too many arguments: ${args.length} provided (expected 1)`)
      }
      const callback = args[0]
      if (typeof callback !== 'function') {
        throw new TypeError(`Callback for tool ${methodName} must be a function`)
      }
      const callbackWrapped: Fn = (() => {
        throw new Error(`Callback for tool ${methodName} must be wrapped with \`tool.unwrapCallback\``)
      }) as unknown as Fn
      (callbackWrapped as any)[callbackMetadataKey] = {
        callback,
      }
      return target.call(this, callbackWrapped as unknown as Fn)
    }

    setToolMetadata(replacementMethod, { runtimeValidationEnabled: true })

    return replacementMethod
  }
}

// Helper function to consume a callback for a tool.callback tool. The main idea is that:
// 1. If running locally, we don't do anything fancy.
// 2. If invoked over RPC, `callback` will actually return a promise that will be resolved
//      and delivered by the RPC layer. We need to chain actions to the actual result:
const unwrapCallback = <A, V>(toolCallback: ToolCallback<(arg: A) => V>, returnSchema: StandardSchemaV1<V, V> | ((arg: unknown) => arg is V)) =>
  <R>(arg: A, then: (result: V) => R, opts?: { catch?: (error: unknown) => R, finally?: () => void }): R => {
    const callback = callbackMetadataKey in toolCallback ? toolCallback[callbackMetadataKey].callback : toolCallback
    let isPromise = false

    try {
      const result = callback(arg)
      if (result instanceof Promise) {
        return result.then((r) => {
          validate(returnSchema, r)
          return then(r)
        }, opts?.catch).finally(opts?.finally)
      }

      validate(returnSchema, result)
      return then(result)
    }
    catch (error) {
      if (opts?.catch) {
        return opts.catch(error)
      }
      throw error
    }
    finally {
      if (!isPromise) {
        opts?.finally?.()
      }
    }
  }

export type ToolAnnotation = typeof toolDef & {
  callback: typeof callbackTool
  unwrap: typeof unwrapCallback
  unsafeNoValidation: typeof toolUnsafeNoValidation
}

export const tool: ToolAnnotation = toolDef as ToolAnnotation
tool.callback = callbackTool
tool.unwrap = unwrapCallback
tool.unsafeNoValidation = toolUnsafeNoValidation

// Special kind of `RpcTarget` that ensures all methods are tools (have the @tool decorator).
// This ensures that:
// 1. Only methods with the @tool decorator are exposed to the RPC layer.
// 2. All methods have input validation.
export class RpcToolset extends RpcTarget {
  constructor() {
    super()
    let prototype = Object.getPrototypeOf(this)
    while (prototype !== null && prototype !== RpcToolset.prototype) {
      for (const key of Object.getOwnPropertyNames(prototype)) {
        if (key === 'constructor') {
          continue
        }
        const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
        const fn = descriptor?.value ?? descriptor?.get
        if (!fn || typeof fn !== 'function') {
          throw new Error(`RpcToolset prototype must be methods or getters: ${key} is not`)
        }
        const meta = fn as unknown as ToolMetadata
        if (!meta[toolMetadataKey]?.runtimeValidationEnabled) {
          throw new Error(`Prototype method \`${key}\` is not a tool. Did you forget to use the @tool decorator?`)
        }
      }
      prototype = Object.getPrototypeOf(prototype)
    }
  }
}
