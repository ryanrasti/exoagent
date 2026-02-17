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
    // Wrap each result with its source item's taints
    const mapped = this.raw.map((v, i) => Value.of(fn(v.raw, i), v.getTaints()))
    // Array taints = original array taints + merged item taints
    const itemTaints = Value.mergeTaints(...this.raw)
    return new ArrayValue(mapped, [...this.getTaints(), ...itemTaints])
  }

  @tool(callbackSchema)
  filter(fn: (item: T, index: number) => boolean): Value<T[]> {
    // Keep taints on filtered items
    const filtered = this.raw.filter((v, i) => fn(v.raw, i))
    // Array taints = original array taints + merged taints from filtered items
    const itemTaints = Value.mergeTaints(...filtered)
    return new ArrayValue(filtered, [...this.getTaints(), ...itemTaints])
  }

  @tool(callbackSchema)
  find(fn: (item: T, index: number) => boolean): Value<T | undefined> {
    const found = this.raw.find((v, i) => fn(v.raw, i))
    // Return the found Value (with its taints) or undefined with array taints
    if (found) {
      return found.withTaints(this.getTaints())
    }
    return Value.of(undefined, this.getTaints())
  }

  @tool(callbackSchema)
  some(fn: (item: T, index: number) => boolean): Value<boolean> {
    // Boolean result doesn't leak item data, just array taints
    return Value.of(this.raw.some((v, i) => fn(v.raw, i)), this.getTaints())
  }

  @tool(callbackSchema)
  every(fn: (item: T, index: number) => boolean): Value<boolean> {
    // Boolean result doesn't leak item data, just array taints
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

  @tool(numberSchema, numberSchema.optional())
  slice(start: number, end?: number): Value<string> {
    return Value.of(this.raw.slice(start, end), this.getTaints())
  }

  @tool(numberSchema, numberSchema.optional())
  substring(start: number, end?: number): Value<string> {
    return Value.of(this.raw.substring(start, end), this.getTaints())
  }

  @tool(z.string())
  includes(searchString: string): Value<boolean> {
    return Value.of(this.raw.includes(searchString), this.getTaints())
  }

  @tool(z.string())
  startsWith(searchString: string): Value<boolean> {
    return Value.of(this.raw.startsWith(searchString), this.getTaints())
  }

  @tool(z.string())
  endsWith(searchString: string): Value<boolean> {
    return Value.of(this.raw.endsWith(searchString), this.getTaints())
  }

  @tool(z.string().or(z.instanceof(RegExp)))
  split(separator: string | RegExp): Value<string[]> {
    return Value.of(this.raw.split(separator), this.getTaints())
  }

  @tool()
  trim(): Value<string> {
    return Value.of(this.raw.trim(), this.getTaints())
  }

  @tool()
  toLowerCase(): Value<string> {
    return Value.of(this.raw.toLowerCase(), this.getTaints())
  }

  @tool()
  toUpperCase(): Value<string> {
    return Value.of(this.raw.toUpperCase(), this.getTaints())
  }

  @tool(z.string(), z.string())
  replace(searchValue: string, replaceValue: string): Value<string> {
    return Value.of(this.raw.replace(searchValue, replaceValue), this.getTaints())
  }

  @tool(z.string(), z.string())
  replaceAll(searchValue: string, replaceValue: string): Value<string> {
    return Value.of(this.raw.replaceAll(searchValue, replaceValue), this.getTaints())
  }

  @tool(z.string())
  indexOf(searchString: string): Value<number> {
    return Value.of(this.raw.indexOf(searchString), this.getTaints())
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
