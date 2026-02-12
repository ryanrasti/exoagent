/**
 * Handler implementations - shared between IPC and HTTP transports
 */

import type { Taint } from '../../eval/utils'
import type { CodeModeResult } from '../../code-mode'
import type { Policy } from '../../policy'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, stepCountIs, tool } from 'ai'
import { codeMode } from '../../code-mode'
import { Value } from '../../eval'
import { ExoAgent } from '../../policy'
import { createAuthenticatedClient, parseClientConfig, startOAuthFlow } from '../google/auth'
import { CalendarClient } from '../google/calendar'
import { GmailClient } from '../google/gmail'
import { deleteSecret, getSecret, getSecretsStatus, setSecret } from './db/secrets'
import { addMessage, createThread, deleteThread, getMessages, getThread, listThreads, messagesToTurns, pinThread, unpinThread, updateThreadTitle } from './db/threads'
import { handle } from './transport'

/** Generate a short title for a thread based on the user's first message */
async function generateThreadTitle(threadId: string, userMessage: string, apiKey: string): Promise<void> {
  const google = createGoogleGenerativeAI({ apiKey })

  const result = await generateText({
    model: google('gemini-2.0-flash'),
    system: 'Generate a very short title (3-6 words max) summarizing the user\'s request. Reply with ONLY the title, no quotes or punctuation.',
    messages: [{ role: 'user', content: userMessage }],
    maxRetries: 0,
  })

  const title = result.text.trim()
  if (title) {
    await updateThreadTitle(threadId, title)
  }
}

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

/** Result from llm() - a Value containing response/data/code with taints */
export type LLMResult = Value<{ response: string, data: unknown, code: string }>

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

  // Check if tool was called
  if (!step?.toolCalls || step.toolCalls.length === 0) {
    throw new Error('Assistant did not use the execute tool. Raw response: ' + llmResponse.text)
  }

  // Check for tool errors - AI SDK may have error info
  if (!step?.toolResults || step.toolResults.length === 0) {
    // Tool was called but no result - likely an error occurred
    // Log full step for debugging
    console.error('[llm] Tool called but no results. Step:', JSON.stringify(step, null, 2))
    throw new Error('Tool execution failed with no result. Check main process logs for details.')
  }

  // Extract the executed code from the tool call
  const toolCall = step.toolResults[0]
  const executedCode = (toolCall.input as { code?: string })?.code ?? ''

  // AI SDK tool results have the result in `output`
  const toolResult = step.toolResults[0] as { output: CodeModeResult }
  const { response, data, taints, error } = toolResult.output

  // If there was an error, throw it with full details
  if (error) {
    const err = new Error(error.message) as Error & { code?: string }
    err.stack = error.stack
    err.code = error.code
    throw err
  }

  // Wrap the result as a Value with the captured taints, including the executed code
  const value = Value.of({ response, data, code: executedCode }, taints)

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
- DO NOT use array methods like .map(), .filter(), .reduce(), .forEach(), etc. Use for loops instead.
- DO NOT use object methods like Object.keys(), Object.values(), Object.entries(), etc. Use for...in loops instead.

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

/**
 * Register all handlers with the transport layer
 */
export function registerHandlers(): void {
  // Secrets
  handle('secrets:status', async () => getSecretsStatus())

  handle('secrets:setGeminiApiKey', async (apiKey: string) => {
    return setSecret('geminiApiKey', apiKey)
  })

  handle('secrets:setGoogleOAuthClient', async (clientJson: string) => {
    // Validate the JSON before saving
    parseClientConfig(clientJson)
    return setSecret('googleOAuthClient', clientJson)
  })

  handle('secrets:startGoogleOAuth', async () => {
    const clientJson = await getSecret('googleOAuthClient')
    if (!clientJson) {
      throw new Error('Google OAuth client not configured')
    }

    const tokens = await startOAuthFlow(clientJson)
    await setSecret('googleTokens', JSON.stringify(tokens))
    return true
  })

  handle('secrets:clearGoogleTokens', async () => {
    await deleteSecret('googleTokens')
  })

  // Thread management
  handle('threads:list', async () => {
    return listThreads()
  })

  handle('threads:create', async () => {
    const id = crypto.randomUUID()
    return createThread(id)
  })

  handle('threads:get', async (threadId: string) => {
    const thread = await getThread(threadId)
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`)
    }
    const messages = await getMessages(threadId)
    return { thread, messages }
  })

  handle('threads:pin', async (threadId: string) => {
    await pinThread(threadId)
  })

  handle('threads:unpin', async (threadId: string) => {
    await unpinThread(threadId)
  })

  handle('threads:delete', async (threadId: string) => {
    await deleteThread(threadId)
  })

  // Chat - now takes threadId instead of history
  handle('chat', async (threadId: string, message: string) => {
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

    // Get or create thread
    let thread = await getThread(threadId)
    const needsTitle = !thread || !thread.title
    if (!thread) {
      thread = await createThread(threadId)
    }

    // Get existing messages and convert to turns
    const existingMessages = await getMessages(threadId)
    const history = messagesToTurns(existingMessages)

    // Save user message
    await addMessage(threadId, {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
    })

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

    // Unwrap the Value for the response (top-level, no further policy check needed)
    const taints = result.getTaints()
    const { response, data, code } = result.unwrap(() => {}) as { response: string, data: unknown, code: string }

    // Save assistant message
    await addMessage(threadId, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: response,
      data,
      taints,
      code,
    })

    // Generate title for threads without one
    if (needsTitle) {
      try {
        await generateThreadTitle(threadId, message, apiKey)
      } catch (err) {
        console.error('[chat] Failed to generate thread title:', err)
      }
    }

    return { response, data, taints, code }
  })
}
