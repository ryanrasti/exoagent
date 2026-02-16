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
import { CalendarClient, MockCalendarClient } from '../google/calendar'
import { GmailClient, MockGmailClient } from '../google/gmail'
import { createMockAgent, COMBINED_DTS, mockPolicy } from '../mock'

// Combined mock agent (state persists across requests)
const mockAgent = createMockAgent()

// Legacy mock instances for backwards compat
const mockGmail = mockAgent.clients.gmail
const mockCalendar = mockAgent.clients.calendar

import { z } from 'zod'
import { deleteSecret, getSecret, getSecretsStatus, setSecret } from './db/secrets'

// Combined ExoAgent for both email and calendar
const agentExo = new ExoAgent(
  ['email', 'calendar'] as const,
  ['email', 'calendar'] as const,
)

/** Builtin toolset with @tool decorators for policy enforcement */
class BuiltinToolset {
  constructor(
    private onRespond: (msg: string) => void = () => {},
    private onSetResult: (result: unknown) => void = () => {},
  ) {}

  @agentExo.tool(z.string())
  respond(msg: string) {
    this.onRespond(msg)
  }

  @agentExo.tool(z.unknown())
  setToolCallResult(result: unknown) {
    this.onSetResult(result)
  }
}

import { addMessage, addTaintsToThread, createThread, createSubthread, deleteThread, getMessages, getSubthreads, getThread, listThreads, messagesToTurns, pinThread, unpinThread, updateThreadTitle } from './db/threads'
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

/** A redaction marker for content moved to a subthread */
export type Redaction = {
  subthread_id: string
  taints: Taint[]
}

/** Format taints for display in redaction marker */
function formatTaintsForContext(taints: Taint[]): string {
  return taints.map(([type, params]) => {
    const principals = params.principals?.join(',') ?? ''
    return principals ? `${type}{principals:${principals}}` : type
  }).join(' ')
}

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

/** Built-in capabilities for agent control flow */
export type BuiltinCaps = {
  /** Send a response message to the user */
  respond: (message: string) => void
  /** Set structured data visible to agent in subsequent turns */
  setToolCallResult: (result: unknown) => void
  // TODO: callLlm and spawnAgent will be added later
}

/** Capabilities exposed to the LLM */
export type LLMCapabilities = {
  /** The API object exposed to codeMode (gmail, calendar, etc.) */
  api: object
  /** Built-in caps - if not provided, llm() creates default ones */
  builtinCaps?: BuiltinCaps
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
export type LLMResult = Value & { raw: { response: string, data: unknown, code: string } }

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

  // State captured by builtin caps during execution
  let responseMessage = ''
  let toolResultData: unknown = null

  // Create builtin caps - use BuiltinToolset for proper @tool decorators
  const builtinCaps = capabilities.builtinCaps ?? new BuiltinToolset(
    (msg) => { responseMessage = msg },
    (result) => { toolResultData = result },
  )

  // Globals: api (user caps) and builtin (respond, setToolCallResult, etc.)
  const globals = { api: capabilities.api, builtin: builtinCaps }

  const google = createGoogleGenerativeAI({ apiKey })

  // Build the code execution tool
  const inputTaints = context.history.flatMap(turn => turn.role === 'assistant' ? turn.taints : [])
  const codeTool = codeMode({
    globals,
    policy,
    dts: context.dts,
    outputSink,
    maxCost,
    inputTaints,
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
    toolChoice: 'required',
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
  const { taints, error } = toolResult.output

  // If there was an error, throw it with full details
  if (error) {
    const err = new Error(error.message) as Error & { code?: string }
    err.stack = error.stack
    err.code = error.code
    throw err
  }

  // Response and data come from builtin caps called during execution
  const value = Value.of({ response: responseMessage, data: toolResultData, code: executedCode }, taints)

  return value as LLMResult
}

// Combined agent system prompt
const MOCK_AGENT_SYSTEM_PROMPT = `You are an AI assistant that helps users manage their email, calendar, Slack, files, and web browsing.

You have access to a single tool called "execute" that runs JavaScript code.

Two globals are available:
- \`api\`: All integrations (api.gmail, api.calendar, api.slack, api.filesystem, api.web)
- \`builtin\`: Agent control functions (builtin.respond, builtin.setToolCallResult)

IMPORTANT:
- You MUST use the execute tool to perform any actions.
- Use builtin.respond(message) to send a response to the user. This is the ONLY output the user will see.
- Use builtin.setToolCallResult(data) to store structured data for future turns. This is NOT displayed to the user - it is only available to you in subsequent turns.
- DO NOT use array methods like .map(), .filter(), .reduce(), .forEach(), etc.
- DO NOT use object methods like Object.keys(), Object.values(), Object.entries(), etc.

When you receive previous assistant turns, they will contain the "response" that was shown to the user and "data" that you stored. Use the "data" to maintain context across turns.
`

// Legacy Gmail/Calendar prompt for backwards compat
const GMAIL_CALENDAR_SYSTEM_PROMPT = MOCK_AGENT_SYSTEM_PROMPT


/** Chat result type */
export interface ChatResult {
  response: string
  data: unknown
  taints: Taint[]
  code: string
  forked?: { subthreadId: string, taints: Taint[] }
}

/** Create a new thread - exported for use by MCP */
export async function handleThreadsCreate(): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  await createThread(id)
  return { id }
}

/** Chat on a thread - exported for use by MCP */
export async function handleChat(threadId: string, message: string, apiKey: string): Promise<ChatResult> {
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

  // Use the generic llm() function with combined mock agent
  const result = await llm({
    context: {
      system: MOCK_AGENT_SYSTEM_PROMPT,
      history,
      message,
      dts: COMBINED_DTS,
    },
    capabilities: {
      api: mockAgent.api,
    },
    policy: mockPolicy,
    outputSink: 'email',
    apiKey,
  })

  // Unwrap the Value for the response
  const taints = result.getTaints()
  const { response, data, code } = result.unwrap(() => {}) as unknown as { response: string, data: unknown, code: string }

  // Check if we need to fork to a subthread
  if (thread.parent_id === null && taints.length > 0) {
    const subthreadId = crypto.randomUUID()
    await createSubthread(subthreadId, threadId, taints)

    // Save the full response in the subthread
    await addMessage(subthreadId, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: response,
      data,
      taints,
      code,
    })

    // Create redaction marker for main thread
    const redaction: Redaction = { subthread_id: subthreadId, taints }
    const redactedContent = `[subthread:${subthreadId} taints:${formatTaintsForContext(taints)}]`

    // Save redacted message in main thread
    await addMessage(threadId, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: redactedContent,
      data: { redaction },
      taints: [],
      code,
    })

    // Generate title for threads without one
    if (needsTitle) {
      generateThreadTitle(threadId, message, apiKey).catch(() => {})
    }

    return { response: redactedContent, data: { redaction }, taints: [], code, forked: { subthreadId, taints } }
  }

  // If in a subthread and we have new taints, accumulate them
  if (thread.parent_id !== null && taints.length > 0) {
    await addTaintsToThread(threadId, taints)
  }

  // Save message to current thread
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
    generateThreadTitle(threadId, message, apiKey).catch(() => {})
  }

  return { response, data, taints, code }
}

/**
 * Register all handlers with the transport layer
 */
export function registerHandlers(): void {
  // Mock state management (for testing)
  handle('mock:seed', async (data: { emails?: any[], events?: any[] }) => {
    if (data.emails) mockAgent.clients.gmail.seed(data.emails)
    if (data.events) mockAgent.clients.calendar.seed(data.events)
    return { ok: true }
  })

  handle('mock:state', async () => {
    return {
      gmail: mockAgent.clients.gmail.getState(),
      calendar: mockAgent.clients.calendar.getState(),
      slack: mockAgent.clients.slack.getState(),
      filesystem: mockAgent.clients.filesystem.getState(),
      web: mockAgent.clients.web.getPostLog(),
    }
  })

  handle('mock:clear', async () => {
    mockAgent.clients.gmail.clear()
    mockAgent.clients.calendar.clear()
    mockAgent.clients.slack.clear()
    mockAgent.clients.filesystem.clear()
    mockAgent.clients.web.clearPostLog()
    return { ok: true }
  })

  // Secrets
  handle('secrets:status', async () => getSecretsStatus())

  handle('secrets:setGeminiApiKey', async (apiKey: string) => {
    return setSecret('geminiApiKey', apiKey)
  })

  handle('secrets:setGoogleOAuthClient', async (clientJson: string) => {
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
  handle('threads:list', async () => listThreads())

  handle('threads:create', async () => handleThreadsCreate())

  handle('threads:get', async (threadId: string) => {
    const thread = await getThread(threadId)
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`)
    }
    const messages = await getMessages(threadId)
    return { thread, messages }
  })

  handle('threads:pin', async (threadId: string) => pinThread(threadId))

  handle('threads:unpin', async (threadId: string) => unpinThread(threadId))

  handle('threads:delete', async (threadId: string) => deleteThread(threadId))

  handle('threads:subthreads', async (parentId: string) => getSubthreads(parentId))

  handle('threads:notifyMain', async (subthreadId: string, messageContent: string) => {
    const thread = await getThread(subthreadId)
    if (!thread) {
      throw new Error(`Thread not found: ${subthreadId}`)
    }
    if (!thread.parent_id) {
      throw new Error(`Thread ${subthreadId} is not a subthread`)
    }

    const notificationContent = `From subthread ${subthreadId}:\n${messageContent}`
    await addMessage(thread.parent_id, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: notificationContent,
      data: { fromSubthread: subthreadId },
      taints: [],
    })

    return { success: true, parentId: thread.parent_id }
  })

  // Chat
  handle('chat', async (threadId: string, message: string) => {
    const apiKey = await getSecret('geminiApiKey')
    if (!apiKey) {
      throw new Error('API key not configured')
    }
    return handleChat(threadId, message, apiKey)
  })
}
