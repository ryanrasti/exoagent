/**
 * Shared builtin toolset for agent control flow.
 *
 * Extends BuiltinFunctions to inherit taint-aware methods like `all`.
 * All methods use @tool from the provided ExoAgent for policy enforcement.
 */

import { z } from 'zod'
import type { ExoAgent } from '../policy'
import { BuiltinFunctions } from '../eval/builtins'

export interface BuiltinToolsetConfig {
  onRespond?: (msg: string) => void
  onSetResult?: (result: unknown) => void
}

/**
 * Create a BuiltinToolset class bound to a specific ExoAgent.
 *
 * This factory is needed because @tool decorators must reference a specific ExoAgent
 * instance, and we want to support different ExoAgent configurations.
 */
export function createBuiltinToolsetClass<
  Sources extends readonly string[],
  Sinks extends readonly string[],
>(exo: ExoAgent<Sources, Sinks>) {
  class BuiltinToolset extends BuiltinFunctions {
    private onRespond: (msg: string) => void
    private onSetResult: (result: unknown) => void

    constructor(config: BuiltinToolsetConfig = {}) {
      super()
      this.onRespond = config.onRespond ?? (() => {})
      this.onSetResult = config.onSetResult ?? (() => {})
    }

    @exo.tool(z.string())
    respond(msg: string) {
      this.onRespond(msg)
    }

    @exo.tool(z.unknown())
    setToolCallResult(result: unknown) {
      this.onSetResult(result)
    }

    /** Get current date/time as ISO string (since new Date() is not supported in sandbox) */
    @exo.tool(z.void())
    now(): string {
      return new Date().toISOString()
    }

    /** Get today's date as YYYY-MM-DD (useful for date queries) */
    @exo.tool(z.void())
    today(): string {
      return new Date().toISOString().split('T')[0]
    }

    /** Get day of week (0=Sunday, 1=Monday, ..., 6=Saturday) for a date string */
    @exo.tool(z.string().optional())
    dayOfWeek(dateStr?: string): number {
      const date = dateStr ? new Date(dateStr) : new Date()
      return date.getDay()
    }

    /** Add days to a date string, returns YYYY-MM-DD */
    @exo.tool(z.object({ date: z.string(), days: z.number() }))
    addDays(args: { date: string, days: number }): string {
      const date = new Date(args.date)
      date.setDate(date.getDate() + args.days)
      return date.toISOString().split('T')[0]
    }

    /** Get the next occurrence of a weekday (0=Sun, 1=Mon, ..., 6=Sat) from a date */
    @exo.tool(z.object({ from: z.string().optional(), weekday: z.number() }))
    nextWeekday(args: { from?: string, weekday: number }): string {
      const date = args.from ? new Date(args.from) : new Date()
      const currentDay = date.getDay()
      const daysUntil = (args.weekday - currentDay + 7) % 7 || 7
      date.setDate(date.getDate() + daysUntil)
      return date.toISOString().split('T')[0]
    }
  }

  return BuiltinToolset
}
