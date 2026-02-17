/**
 * Combined mock agent with all plugins wired up
 */

import { z } from 'zod'
import { ExoAgent } from '../../policy'
import { MockCalendarClient, CALENDAR_DTS } from '../google/calendar'
import { MockGmailClient, GMAIL_DTS } from '../google/gmail'
import { MockFilesystemClient, FILESYSTEM_DTS } from './filesystem'
import { MockSlackClient, SLACK_DTS } from './slack'
import { MockWebClient, WEB_DTS } from './web'

/**
 * Combined ExoAgent with all source/sink types from all plugins
 *
 * Sources: data that comes INTO the agent
 * Sinks: places where data goes OUT
 */
export const mockExo = new ExoAgent(
  // Sources - where data comes from
  ['email', 'calendar', 'slack', 'file', 'web'] as const,
  // Sinks - where data goes to
  ['email', 'calendar', 'slack', 'file', 'external'] as const,
)

/**
 * Default deny rules:
 * - Anything → external (prevent exfiltration to unknown endpoints)
 *
 * Cross-plugin flows are ALLOWED by default (that's the point of an agent!)
 * Principal mismatches will still trigger denials via the callback rule.
 */
export const DEFAULT_DENY_RULES = [
  // Block all internal data from going to external endpoints
  { sources: ['email', 'calendar', 'slack', 'file', 'web'], sinks: ['external'] },

  // Principal mismatch rule: deny if sink principals aren't a subset of source principals
  // Data can only flow to people who already had access to it
  // This catches cases like: alice's email → attacker@evil.com (attacker wasn't on the email)
  (source: [string, { principals?: string[] }], sink: [string, { principals?: string[] }]) => {
    const sourcePrincipals = source[1]?.principals ?? []
    const sinkPrincipals = sink[1]?.principals ?? []

    // If either has no principals, allow (can't check)
    if (sourcePrincipals.length === 0 || sinkPrincipals.length === 0) {
      return 'allow' as const
    }

    // Check that ALL sink principals are in source principals (subset check)
    const isSubset = sinkPrincipals.every(p => sourcePrincipals.includes(p))
    return isSubset ? 'allow' as const : 'deny' as const
  },
]

/** Combined policy with default deny rules */
export const mockPolicy = mockExo.policy(DEFAULT_DENY_RULES)

/** Builtin toolset for agent control flow */
class BuiltinToolset {
  constructor(
    private onRespond: (msg: string) => void = () => {},
    private onSetResult: (result: unknown) => void = () => {},
  ) {}

  @mockExo.tool(z.string())
  respond(msg: string) {
    this.onRespond(msg)
  }

  @mockExo.tool(z.unknown())
  setToolCallResult(result: unknown) {
    this.onSetResult(result)
  }

  @mockExo.tool(z.array(z.unknown()))
  all(promises: Promise<unknown>[]): Promise<unknown[]> {
    return Promise.all(promises)
  }
}

/** Combined type definitions for LLM */
export const COMBINED_DTS = `
// Gmail
${GMAIL_DTS}

// Calendar
${CALENDAR_DTS}

// Slack
${SLACK_DTS}

// Filesystem
${FILESYSTEM_DTS}

// Web
${WEB_DTS}

// Available as api.gmail, api.calendar, api.slack, api.filesystem, api.web
interface API {
  gmail: Gmail
  calendar: Calendar
  slack: Slack
  filesystem: Filesystem
  web: Web
}

// Builtin functions
interface Builtin {
  /** Send a response message to the user (this is what they see) */
  respond(message: string): void

  /** Store data for future turns (not shown to user) */
  setToolCallResult(data: unknown): void
}

// Globals available in your code:
// - api: API object with all integrations
// - builtin: Builtin functions for responding to user
`

export interface MockAgentConfig {
  onRespond?: (msg: string) => void
  onSetResult?: (result: unknown) => void
}

/**
 * Create a mock agent with all plugins wired up
 */
export function createMockAgent(config: MockAgentConfig = {}) {
  const gmail = new MockGmailClient()
  const calendar = new MockCalendarClient()
  const slack = new MockSlackClient()
  const filesystem = new MockFilesystemClient()
  const web = new MockWebClient()
  const builtin = new BuiltinToolset(config.onRespond, config.onSetResult)

  return {
    api: {
      gmail,
      calendar,
      slack,
      filesystem,
      web,
    },
    builtin,
    policy: mockPolicy,
    dts: COMBINED_DTS,
    // Expose individual clients for testing/seeding
    clients: { gmail, calendar, slack, filesystem, web },
  }
}

// Re-export for convenience
export { MockGmailClient } from '../google/gmail'
export { MockCalendarClient } from '../google/calendar'
export { MockSlackClient } from './slack'
export { MockFilesystemClient } from './filesystem'
export { MockWebClient } from './web'
