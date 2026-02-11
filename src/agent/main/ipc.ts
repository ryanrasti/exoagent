import type { SafeEvalValueInner, Taint } from '../../eval/utils'
import type { CodeModeResult } from '../../code-mode'
import type { Policy } from '../../policy'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, stepCountIs, tool } from 'ai'
import { ipcMain } from 'electron'
import { codeMode } from '../../code-mode'
import { Value } from '../../eval'
import { ExoAgent } from '../../policy'
import { createAuthenticatedClient, parseClientConfig, startOAuthFlow } from '../google/auth'
import { CalendarClient } from '../google/calendar'
import { GmailClient } from '../google/gmail'
import { deleteSecret, getSecret, getSecretsStatus, setSecret } from './db/secrets'

/** A turn in the conversation history */
export type Turn =
  | { role: 'user', content: string }
  | { role: 'assistant', response: string, data: unknown, taints: Taint[] }

/** Context for an LLM call */
export type LLMContext = {
  /** System prompt */
  system: string
  /** Conversation history */
  history: Turn[]
  /** Current user message */
  message: string
  /** Type definitions for the API (shown to LLM) */
  dts?: string
}

/** Capabilities exposed to the LLM */
export type LLMCapabilities = {
  /** The API object exposed to codeMode */
  api: object
}

/** Options for the LLM function */
export type LLMOptions<Sinks extends readonly string[]> = {
  /** LLM context (system prompt, history, message) */
  context: LLMContext
  /** Capabilities exposed to the LLM */
  capabilities: LLMCapabilities
  /** Policy for taint checking */
  policy: Policy<string[], [...Sinks]>
  /** The sink to check at the output boundary */
  outputSink: Sinks[number]
  /** Maximum cost (tool calls) per turn. Defaults to 10. */
  maxCost?: number
  /** API key for the LLM provider */
  apiKey: string
}

/** Format history for the LLM */
function formatHistoryForLLM(history: Turn[]): Array<{ role: 'user' | 'assistant', content: string }> {
  return history.map((turn) => {
    if (turn.role === 'user') {
      return { role: 'user' as const, content: turn.content }
    }
    else {
      // Format assistant turn as JSON so LLM can see both response and data
      return {
        role: 'assistant' as const,
        content: JSON.stringify({ response: turn.response, data: turn.data }),
      }
    }
  })
}

/** Result from llm() - includes the Value for taint tracking */
export type LLMResult = {
  /** The Value containing response/data with taints */
  value: Value<{ response: Value<string>, data: Value<SafeEvalValueInner> }>
  /** Convenience: extracted taints from the value */
  taints: Taint[]
}

/**
 * Execute an LLM turn with the given context, capabilities, and policy.
 *
 * This is the core LLM function that can be:
 * 1. Called directly for top-level agent execution
 * 2. Exposed as a capability for subagent composition (with attenuated caps/policy)
 *
 * Returns a Value so that taints propagate properly when used as a capability.
 */
export async function llm<Sinks extends readonly string[]>(
  opts: LLMOptions<Sinks>,
): Promise<LLMResult> {
  const { context, capabilities, policy, outputSink, maxCost = 10, apiKey } = opts

  const google = createGoogleGenerativeAI({ apiKey })

  // Build the code execution tool
  const codeTool = codeMode({
    api: capabilities.api,
    policy,
    dts: context.dts,
    outputSink,
    maxCost,
    inputTaints: context.history.flatMap(turn => turn.role === 'assistant' ? turn.taints : []),
  })

  // Format history for LLM
  const formattedHistory = formatHistoryForLLM(context.history)

  // Single LLM call - no automatic retries or multi-step loops
  const llmResponse = await generateText({
    model: google('gemini-2.0-flash'),
    system: context.system,
    messages: [
      ...formattedHistory,
      { role: 'user', content: context.message },
    ],
    tools: {
      execute: tool(codeTool),
    },
    stopWhen: stepCountIs(1),
    maxRetries: 0,
  })

  // Extract the tool result
  const step = llmResponse.steps[0]
  if (!step?.toolResults || step.toolResults.length === 0) {
    // LLM didn't call the tool - return error
    throw new Error('Assistant did not use the execute tool. Raw response: ' + llmResponse.text)
  }

  const toolResult = step.toolResults[0] as { result: CodeModeResult }
  const { response, data, taints } = toolResult.result

  // Wrap the result as a Value with the captured taints
  const value = Value.of({ response, data }, taints)

  return value
}

// Gmail/Calendar specific configuration
const GMAIL_CALENDAR_SYSTEM_PROMPT = `You are an AI assistant that helps users manage their email and calendar.

You have access to a single tool called "execute" that runs JavaScript code to interact with the Gmail and Calendar APIs.

IMPORTANT:
- You MUST use the execute tool to perform any actions - you cannot access email or calendar data without it.
- Your code MUST return an object with exactly this shape: { response: string, data: unknown }
  - "response": The message to show the user
  - "data": Any data you want to remember for future turns (not shown to user)
- If you don't need to call any APIs, still use the execute tool with simple code that returns the response.

When you receive previous assistant turns, they will contain the "response" that was shown to the user and "data" that you stored. Use the "data" to maintain context across turns.
`

const GMAIL_CALENDAR_DTS = `
interface EmailMessage {
  id: string
  threadId: string
  labels: string[]
  from: string | undefined
  to: string[]
  cc: string[]
  subject: string | undefined
  date: Date | undefined
  text: string | undefined
  html: string | false | undefined
}

interface CalendarEvent {
  id: string
  summary: string | undefined
  description: string | undefined
  location: string | undefined
  start: { dateTime?: string; date?: string } | undefined
  end: { dateTime?: string; date?: string } | undefined
  htmlLink: string | undefined
  attendees: string[]
}

interface Gmail {
  list(opts: { maxResults: number; query: string }): Promise<Array<{ id: string; threadId: string }>>
  get(opts: { id: string }): Promise<EmailMessage>
  send(opts: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string }): Promise<{ success: boolean; id: string }>
  createDraft(opts: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string }): Promise<{ success: boolean; draftId: string }>
}

interface Calendar {
  list(opts: { maxResults: number; timeMin: string; timeMax?: string; calendarId?: string }): Promise<CalendarEvent[]>
  get(opts: { eventId: string; calendarId?: string }): Promise<CalendarEvent>
  create(opts: { summary: string; start: string; end: string; description?: string; location?: string; attendees?: string[]; calendarId?: string }): Promise<CalendarEvent>
  update(opts: { eventId: string; summary?: string; description?: string; location?: string; start?: string; end?: string; attendees?: string[]; calendarId?: string }): Promise<CalendarEvent>
  delete(opts: { eventId: string; calendarId?: string }): Promise<{ success: boolean }>
  quickAdd(opts: { text: string; calendarId?: string }): Promise<CalendarEvent>
}

interface Api {
  gmail: Gmail
  calendar: Calendar
}
`

// Combined ExoAgent for both email and calendar
const agentExo = new ExoAgent(
  ['email', 'calendar'] as const,
  ['email', 'calendar'] as const,
)

export function setupIpc(): void {
  // Secrets
  ipcMain.handle('secrets:status', () => getSecretsStatus())

  ipcMain.handle('secrets:setGeminiApiKey', (_, apiKey: string) => {
    return setSecret('geminiApiKey', apiKey)
  })

  ipcMain.handle('secrets:setGoogleOAuthClient', (_, clientJson: string) => {
    // Validate the JSON before saving
    parseClientConfig(clientJson)
    return setSecret('googleOAuthClient', clientJson)
  })

  ipcMain.handle('secrets:startGoogleOAuth', async () => {
    const clientJson = await getSecret('googleOAuthClient')
    if (!clientJson) {
      throw new Error('Google OAuth client not configured')
    }

    const tokens = await startOAuthFlow(clientJson)
    await setSecret('googleTokens', JSON.stringify(tokens))
    return true
  })

  ipcMain.handle('secrets:clearGoogleTokens', async () => {
    await deleteSecret('googleTokens')
  })

  // Chat - uses the generic llm() function with gmail/calendar config
  ipcMain.handle('chat', async (_, message: string, history: Turn[]) => {
    const apiKey = await getSecret('geminiApiKey')
    if (!apiKey) {
      throw new Error('API key not configured')
    }

    // Get Google clients if available
    const clientJson = await getSecret('googleOAuthClient')
    const tokensJson = await getSecret('googleTokens')

    if (!clientJson || !tokensJson) {
      throw new Error('Google APIs not configured. Please set up OAuth first.')
    }

    const tokens = JSON.parse(tokensJson)
    const authClient = createAuthenticatedClient(clientJson, tokens)
    const gmail = new GmailClient(authClient)
    const calendar = new CalendarClient(authClient)

    // Create policy with deny rules for cross-principal data flow
    const policy = agentExo.policy([
      // Callback rule: email/calendar data can only flow to recipients who had access
      (source, sink) => {
        const sourcePrincipals = source[1].principals ?? []
        const sinkPrincipals = sink[1].principals ?? []
        // If source has no principals (public data), allow
        if (sourcePrincipals.length === 0)
          return 'allow'
        // If sink has no principals (no recipients), allow
        if (sinkPrincipals.length === 0)
          return 'allow'
        // Check that all sink principals are in source principals
        const allowed = sinkPrincipals.every(p => sourcePrincipals.includes(p))
        return allowed ? 'allow' : 'deny'
      },
    ])

    // Use the generic llm() function
    const result = await llm({
      context: {
        system: GMAIL_CALENDAR_SYSTEM_PROMPT,
        history,
        message,
        dts: GMAIL_CALENDAR_DTS,
      },
      capabilities: {
        api: { gmail, calendar },
      },
      policy,
      outputSink: 'email',
      apiKey,
    })

    // Unwrap the Value for the IPC response (top-level, no further policy check needed)
    // TODO: eventually we actually do need a policy check for response -> i.e., to keep
    //       chat clean from certain taints
    const { response, data } = result.value.unwrap(() => {}) as unknown as { response: string, data: unknown }
    return { response, data, taints: result.taints }
  })
}
