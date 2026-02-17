/**
 * Builtin Value subclasses with @tool-annotated methods.
 *
 * These provide array/object operations that propagate taints correctly.
 * Methods are marked with @tool so that getSlot can return them as capabilities.
 */

import type { SafeEvalValueInner, Taint, TaintsInput, ValueOptions } from './utils'
import { z } from 'zod'
import { tool } from '../policy'
import { Value } from './utils'

// Schema for callback functions (validated loosely - actual fn validation happens at runtime)
const callbackSchema = z.function()
const numberSchema = z.number()

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

  @tool(callbackSchema)
  map<U extends SafeEvalValueInner>(fn: (item: T, index: number) => U): Value<U[]> {
    const mapped = this.raw.map((v, i) => fn(v.raw, i))
    return Value.of(mapped, this.getTaints())
  }

  @tool(callbackSchema)
  filter(fn: (item: T, index: number) => boolean): Value<T[]> {
    const filtered = this.raw.filter((v, i) => fn(v.raw, i)).map(v => v.raw)
    return Value.of(filtered, this.getTaints())
  }

  @tool(callbackSchema)
  find(fn: (item: T, index: number) => boolean): Value<T | undefined> {
    const found = this.raw.find((v, i) => fn(v.raw, i))
    return Value.of(found?.raw, this.getTaints())
  }

  @tool(callbackSchema)
  some(fn: (item: T, index: number) => boolean): Value<boolean> {
    return Value.of(this.raw.some((v, i) => fn(v.raw, i)), this.getTaints())
  }

  @tool(callbackSchema)
  every(fn: (item: T, index: number) => boolean): Value<boolean> {
    return Value.of(this.raw.every((v, i) => fn(v.raw, i)), this.getTaints())
  }

  @tool(numberSchema)
  at(index: number): Value<T | undefined> {
    const found = this.raw.at(index)
    return Value.of(found?.raw, this.getTaints())
  }

  @tool(numberSchema.optional(), numberSchema.optional())
  slice(start?: number, end?: number): Value<T[]> {
    const sliced = this.raw.slice(start, end).map(v => v.raw)
    return Value.of(sliced, this.getTaints())
  }

  @tool(z.string().optional())
  join(separator?: string): Value<string> {
    const joined = this.raw.map(v => v.raw).join(separator)
    return Value.of(joined, this.getTaints())
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
 * Register ArrayValue as the factory for array values.
 * This makes Value.of return ArrayValue for arrays automatically.
 */
export function registerArrayValueFactory(): void {
  Value.arrayFactory = (raw, taints, options) => new ArrayValue(raw, taints, options)
}

// Auto-register on import
registerArrayValueFactory()
