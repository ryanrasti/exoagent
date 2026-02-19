/**
 * Builtin Value subclasses with builtin-annotated methods.
 *
 * These provide array/object operations that propagate taints correctly.
 * Methods are marked with @builtin so that getSlot can return them as capabilities.
 * Unlike @tool, @builtin doesn't validate args (builtins receive Value-wrapped args).
 */

import type { SafeEvalValueInner, TaintsInput, ValueOptions } from './utils'
import { getPolicyMetadata, setPolicyMetadata } from '../meta'
import { Value } from './utils'

/**
 * Decorator for builtin methods on Value subclasses.
 * Registers metadata so getSlot knows these are valid methods.
 * No validation - builtins receive Value-wrapped args directly.
 */
function builtin<This, Args extends any[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): void {
  const methodName = context.name
  if (typeof methodName !== 'string') {
    throw new TypeError('Builtin decorator requires string method name')
  }
  context.addInitializer(function (this: This) {
    const metadata = getPolicyMetadata(this as object) ?? {}
    // Mark as builtin: true so getSlot can distinguish from @tool methods
    setPolicyMetadata(this as object, { ...metadata, [methodName]: { builtin: true } })
  })
}

/**
 * ArrayValue extends Value for array types, adding map/filter/etc.
 * Created automatically by Value.of() when the raw value is an array.
 */
export class ArrayValue<T extends SafeEvalValueInner = SafeEvalValueInner> extends Value<Value<T>[]> {
  constructor(
    raw: Value<T>[],
    taints: TaintsInput = [],
    options: ValueOptions = {},
  ) {
    super(raw, taints, options)
  }

  // NOTE: These methods are called as builtinFunctions from eval, meaning the callback `fn`
  // is an internal eval function wrapped in a Value. It receives Value args and returns Value results.

  @builtin
  map<U extends SafeEvalValueInner>(fn: Value<(item: Value<T>, index: Value<number>) => Value<U>>): Value<Value<U>[]> {
    const mapped = this.raw.map((v, i) => {
      const result = fn.raw(v, Value.of(i, []))
      // If callback is async, result is a Promise - chain taints onto resolution
      if (result instanceof Promise) {
        return Value.of(result.then((r: Value<U>) => r.withTaints(v.getTaints())), v.getTaints())
      }
      // Merge the source item's taints into the result
      return result.withTaints(v.getTaints())
    })
    // Array taints = original array taints + merged item taints
    const itemTaints = Value.mergeTaints(...this.raw)
    return new ArrayValue(mapped, [...this.getTaints(), ...itemTaints])
  }

  @builtin
  filter(fn: Value<(item: Value<T>, index: Value<number>) => Value<boolean>>): Value<T[]> {
    const filtered = this.raw.filter((v, i) => {
      const result = fn.raw(v, Value.of(i, []))
      return result.raw // Use raw boolean for filter condition
    })
    // Array taints = original array taints + merged taints from filtered items
    const itemTaints = Value.mergeTaints(...filtered)
    return new ArrayValue(filtered, [...this.getTaints(), ...itemTaints])
  }

  @builtin
  find(fn: Value<(item: Value<T>, index: Value<number>) => Value<boolean>>): Value<T | undefined> {
    const found = this.raw.find((v, i) => {
      const result = fn.raw(v, Value.of(i, []))
      return result.raw
    })
    // Return the found Value (with its taints) or undefined with array taints
    if (found) {
      return found.withTaints(this.getTaints())
    }
    return Value.of(undefined, this.getTaints())
  }

  @builtin
  some(fn: Value<(item: Value<T>, index: Value<number>) => Value<boolean>>): Value<boolean> {
    const result = this.raw.some((v, i) => {
      const r = fn.raw(v, Value.of(i, []))
      return r.raw
    })
    return Value.of(result, this.getTaints())
  }

  @builtin
  every(fn: Value<(item: Value<T>, index: Value<number>) => Value<boolean>>): Value<boolean> {
    const result = this.raw.every((v, i) => {
      const r = fn.raw(v, Value.of(i, []))
      return r.raw
    })
    return Value.of(result, this.getTaints())
  }

  @builtin
  at(index: Value<number>): Value<T | undefined> {
    const found = this.raw.at(index.raw)
    if (found) {
      return found.withTaints(this.getTaints())
    }
    return Value.of(undefined, this.getTaints())
  }

  @builtin
  slice(start?: Value<number>, end?: Value<number>): Value<T[]> {
    const sliced = this.raw.slice(start?.raw, end?.raw)
    // Keep items as Values with their taints
    const itemTaints = Value.mergeTaints(...sliced)
    return new ArrayValue(sliced, [...this.getTaints(), ...itemTaints])
  }

  @builtin
  join(separator?: Value<string>): Value<string> {
    // Join extracts raw values from items - result gets all taints
    const joined = this.raw.map(v => String(v.raw)).join(separator?.raw)
    const itemTaints = Value.mergeTaints(...this.raw)
    return Value.of(joined, [...this.getTaints(), ...itemTaints])
  }

  /**
   * Override withTaints to return ArrayValue.
   */
  withTaints(extra: TaintsInput, shallow: boolean = false): ArrayValue<T> {
    const base = super.withTaints(extra, shallow)
    return new ArrayValue<T>(base.raw as Value<T>[], base.taints, base.options)
  }

  toString(): string {
    return `ArrayValue(${this.raw.map(v => v.toString()).join(', ')})`
  }
}

/**
 * StringValue extends Value for string types, adding slice/includes/etc.
 * Created automatically by Value.of() when the raw value is a string.
 */
export class StringValue extends Value<string> {
  constructor(
    raw: string,
    taints: TaintsInput = [],
    options: ValueOptions = {},
  ) {
    super(raw, taints, options)
  }

  @builtin
  slice(start: Value<number>, end?: Value<number>): Value<string> {
    return Value.of(this.raw.slice(start.raw, end?.raw), this.getTaints())
  }

  @builtin
  substring(start: Value<number>, end?: Value<number>): Value<string> {
    return Value.of(this.raw.substring(start.raw, end?.raw), this.getTaints())
  }

  @builtin
  includes(searchString: Value<string>): Value<boolean> {
    return Value.of(this.raw.includes(searchString.raw), this.getTaints())
  }

  @builtin
  startsWith(searchString: Value<string>): Value<boolean> {
    return Value.of(this.raw.startsWith(searchString.raw), this.getTaints())
  }

  @builtin
  endsWith(searchString: Value<string>): Value<boolean> {
    return Value.of(this.raw.endsWith(searchString.raw), this.getTaints())
  }

  @builtin
  split(separator: Value<string>): Value<string[]> {
    return Value.of(this.raw.split(separator.raw), this.getTaints())
  }

  @builtin
  trim(): Value<string> {
    return Value.of(this.raw.trim(), this.getTaints())
  }

  @builtin
  toLowerCase(): Value<string> {
    return Value.of(this.raw.toLowerCase(), this.getTaints())
  }

  @builtin
  toUpperCase(): Value<string> {
    return Value.of(this.raw.toUpperCase(), this.getTaints())
  }

  @builtin
  replace(searchValue: Value<string>, replaceValue: Value<string>): Value<string> {
    return Value.of(this.raw.replace(searchValue.raw, replaceValue.raw), this.getTaints())
  }

  @builtin
  replaceAll(searchValue: Value<string>, replaceValue: Value<string>): Value<string> {
    return Value.of(this.raw.replaceAll(searchValue.raw, replaceValue.raw), this.getTaints())
  }

  @builtin
  indexOf(searchString: Value<string>): Value<number> {
    return Value.of(this.raw.indexOf(searchString.raw), this.getTaints())
  }

  /**
   * Override withTaints to return StringValue.
   */
  withTaints(extra: TaintsInput, shallow: boolean = false): StringValue {
    const base = super.withTaints(extra, shallow)
    return new StringValue(base.raw as string, base.taints, base.options)
  }

  toString(): string {
    return `StringValue("${this.raw.slice(0, 50)}${this.raw.length > 50 ? '...' : ''}")`
  }
}

/**
 * Register ArrayValue and StringValue as factories for their types.
 * This makes Value.of return the appropriate subclass automatically.
 */
export function registerArrayValueFactory(): void {
  Value.arrayFactory = (raw, taints, options) => new ArrayValue(raw, taints, options)
  Value.stringFactory = (raw, taints, options) => new StringValue(raw, taints, options)
}

// Auto-register on import
registerArrayValueFactory()

/**
 * Builtin functions class. Methods are marked with @builtin so getSlot
 * returns them with builtinFunction: true, bypassing doStubCall.
 */
export class BuiltinFunctions {
  /**
   * Await all promises in an array, preserving taints on resolved values.
   * This is the builtin equivalent of Promise.all but taint-aware.
   */
  @builtin
  async all(promises: Value<Value<Promise<Value>>[]>): Promise<Value<Value[]>> {
    const promiseArray = promises.raw as Value<Promise<Value>>[]

    // Await all promises - each resolves to a Value with taints
    const results = await Promise.all(
      promiseArray.map(async (p) => {
        const resolved = await p.raw
        // Merge the promise wrapper's taints into the resolved value
        return resolved.withTaints(p.getTaints())
      })
    )

    // Merge all result taints into the array + promises array taints
    const allTaints = [...promises.getTaints(), ...Value.mergeTaints(...results)]
    return new ArrayValue(results, allTaints)
  }
}

/**
 * Taint-aware Promise utilities. Exposed as `Promise` in the sandbox
 * so users can write `Promise.all(...)` instead of `builtin.all(...)`.
 */
export class PromiseUtils {
  /**
   * Await all promises in an array, preserving taints on resolved values.
   * Taint-aware replacement for Promise.all.
   */
  @builtin
  async all(promises: Value<Value<Promise<Value>>[]>): Promise<Value<Value[]>> {
    const promiseArray = promises.raw as Value<Promise<Value>>[]

    // Await all promises - each resolves to a Value with taints
    const results = await Promise.all(
      promiseArray.map(async (p) => {
        const resolved = await p.raw
        // Merge the promise wrapper's taints into the resolved value
        return resolved.withTaints(p.getTaints())
      })
    )

    // Merge all result taints into the array + promises array taints
    const allTaints = [...promises.getTaints(), ...Value.mergeTaints(...results)]
    return new ArrayValue(results, allTaints)
  }
}

/** Singleton instance for use in sandbox global scope */
export const promiseUtils = new PromiseUtils()
