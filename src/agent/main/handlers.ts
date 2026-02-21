/**
 * Handler implementations - shared between IPC and HTTP transports
 */

import type { CodeModeResult, GlobalScope } from '../../code-mode'
import type { Taint } from '../../eval/utils'
import type { Policy } from '../../policy'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, stepCountIs, tool } from 'ai'
import { codeMode } from '../../code-mode'
import { registerArrayValueFactory, Value } from '../../eval'
// Scope serialization for DB persistence
import { deserializeScope, serializeScope } from '../../eval/scope'
import { createBuiltinToolsetClass } from '../builtin'
import { createAuthenticatedClient, parseClientConfig, startOAuthFlow } from '../google/auth'
import { CalendarClient, MockCalendarClient } from '../google/calendar'

import { GmailClient, MockGmailClient } from '../google/gmail'

import { COMBINED_DTS, createMockAgent, mockExo, mockPolicy } from '../mock'

import { deleteSecret, getSecret, getSecretsStatus, setSecret } from './db/secrets'

import { addMessage, addTaintsToThread, createSubthread, createThread, deleteThread, getMessages, getSubthreads, getThread, listThreads, messagesToTurns, pinThread, unpinThread, updateThreadScope, updateThreadTitle } from './db/threads'
import { handle } from './transport'

// Ensure ArrayValue factory is registered before any policy code runs
registerArrayValueFactory()

// Combined mock agent (state persists across requests)
const mockAgent = createMockAgent()

// Legacy mock instances for backwards compat
const mockGmail = mockAgent.clients.gmail
const mockCalendar = mockAgent.clients.calendar

// Cached real Google clients (created lazily when tokens are available)
let cachedGoogleClients: { gmail: GmailClient, calendar: CalendarClient } | null = null

/** Get the API object - uses real Google clients if tokens available, otherwise mock */
async function getApi(): Promise<typeof mockAgent.api> {
  // Check for Google tokens
  const clientJson = await getSecret('googleOAuthClient')
  const tokensJson = await getSecret('googleTokens')

  if (clientJson && tokensJson) {
    // Use real Google clients
    if (!cachedGoogleClients) {
      const tokens = JSON.parse(tokensJson)
      const authClient = createAuthenticatedClient(clientJson, tokens)
      cachedGoogleClients = {
        gmail: new GmailClient(authClient),
        calendar: new CalendarClient(authClient),
      }
    }
    return {
      gmail: cachedGoogleClients.gmail,
      calendar: cachedGoogleClients.calendar,
      // Keep using mock for other integrations
      slack: mockAgent.clients.slack,
      filesystem: mockAgent.clients.filesystem,
      web: mockAgent.clients.web,
    }
  }

  // Fall back to mock
  return mockAgent.api
}

// Use the shared mockExo from mock/index.ts - it has the correct source/sink types
// The BuiltinToolset is created from that ExoAgent
const BuiltinToolset = createBuiltinToolsetClass(mockExo)

/** Generate a short title for a thread based on the user's first message */
async function generateThreadTitle(threadId: string, userMessage: string, apiKey: string): Promise<void> {
  const google = createGoogleGenerativeAI({ apiKey })

  const result = await generateText({
    model: google('gemini-3-flash-preview'),
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
export type Turn
  = | { role: 'user', content: string }
    | { role: 'assistant', response: string, data: unknown, taints: Taint[], code: string | null }

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
  /** Existing REPL scope to reuse (for variable persistence across turns) */
  scope?: GlobalScope
  /** Model to use. Defaults to gemini-2.0-flash */
  model?: string
  /** Allow auto-continue if setToolCallResult is called. Defaults to true. Set to false to prevent recursive calls. */
  allowContinue?: boolean
}

/** Format history for the LLM */
function formatHistoryForLLM(history: Turn[]): Array<{ role: 'user' | 'assistant', content: string }> {
  return history.map((turn) => {
    if (turn.role === 'user') {
      return { role: 'user' as const, content: turn.content }
    }
    else {
      // Show the code that was executed - variables persist in the REPL
      // Also show the data inline as a comment so LLM has context
      let content = turn.code || ''
      if (turn.data && typeof turn.data === 'object') {
        const entries = Object.entries(turn.data as Record<string, unknown>)
        if (entries.length > 0) {
          const [varName, value] = entries[0]
          // Show the value assigned to the variable to help LLM reason
          content += `\n\n// ${varName} is now: ${JSON.stringify(value, null, 2).split('\n').join('\n// ')}`
        }
      }
      return {
        role: 'assistant' as const,
        content,
      }
    }
  })
}

/** Result from llm() - a Value containing response/data/code with taints, plus scope for REPL persistence */
export type LLMResult = Value & { raw: { response: string, data: unknown, code: string }, scope: GlobalScope }

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
  const { context, capabilities, policy, outputSink, maxCost = 10, apiKey, scope: existingScope, model = 'gemini-2.0-flash', allowContinue = true } = opts

  // State captured by builtin caps during execution
  let responseMessage = ''
  let toolResultData: unknown = null
  let toolResultTaints: Taint[] = []
  let capturedScope: GlobalScope | undefined

  // Create builtin caps - use BuiltinToolset for proper @tool decorators
  const builtinCaps = capabilities.builtinCaps ?? new BuiltinToolset({
    onRespond: (msg) => { responseMessage = msg },
    onSetResult: (result) => {
      toolResultData = result.unwrap(() => {})
      toolResultTaints = result.getTaints()
    },
  })

  // Globals: api (user caps) and builtin (respond, setToolCallResult, etc.)
  const globals = { api: capabilities.api, builtin: builtinCaps }

  const google = createGoogleGenerativeAI({ apiKey })

  // Build the code execution tool with optional scope for REPL persistence
  const inputTaints = context.history.flatMap(turn => turn.role === 'assistant' ? turn.taints : [])
  const codeTool = codeMode({
    globals,
    policy,
    dts: context.dts,
    outputSink,
    maxCost,
    inputTaints,
    scope: existingScope,
    onScope: (scope) => { capturedScope = scope },
  })

  // Format history for LLM
  const formattedHistory = formatHistoryForLLM(context.history)

  // Log formatted history for debugging
  if (formattedHistory.length > 0) {
    console.log('[llm] Formatted history for LLM:', JSON.stringify(formattedHistory, null, 2))
  }

  // Single LLM call - no automatic retries or multi-step loops
  const llmResponse = await generateText({
    model: google(model),
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
    temperature: 0,
  })

  // Extract the tool result
  const step = llmResponse.steps[0]

  // Check if tool was called
  if (!step?.toolCalls || step.toolCalls.length === 0) {
    throw new Error(`Assistant did not use the execute tool. Raw response: ${llmResponse.text}`)
  }

  // Check for tool errors - AI SDK may have error info
  if (!step?.toolResults || step.toolResults.length === 0) {
    // Tool was called but no result - likely an error occurred
    // Log full step for debugging
    console.log('[llm] Tool called but no results. Step:', JSON.stringify(step, null, 2))
    throw new Error('Tool execution failed with no result. Check main process logs for details.')
  }

  // Extract the executed code from the tool call
  const toolCall = step.toolResults[0]
  const executedCode = (toolCall.input as { code?: string })?.code ?? ''

  console.log('[llm] Executed code:', executedCode)

  // AI SDK tool results have the result in `output`
  const toolResult = step.toolResults[0] as { output: CodeModeResult }
  const { error } = toolResult.output

  // If there was an error, throw it with full details
  if (error) {
    const err = new Error(error.message) as Error & { code?: string, scope?: GlobalScope }
    err.stack = error.stack
    err.code = error.code
    err.scope = capturedScope // Include scope even on error so REPL state is preserved
    throw err
  }

  // Response and data come from builtin caps called during execution
  // Taints come from setToolCallResult (captured via raw: true)
  const value = Value.of({ response: responseMessage, data: toolResultData, code: executedCode }, toolResultTaints) as LLMResult
  value.scope = capturedScope!

  // If setToolCallResult was called and we're allowed to continue, do one more turn
  // so the LLM can reason about the data it just stored
  if (toolResultData !== null && allowContinue) {
    // Build updated history with the assistant's turn (but no new user message)
    const updatedHistory: Turn[] = [
      ...context.history,
      { role: 'user', content: context.message },
      { role: 'assistant', response: responseMessage, data: toolResultData, taints: toolResultTaints, code: executedCode },
    ]

    // Recursively call llm with allowContinue: false to prevent infinite loops
    console.log('[llm] Auto-continuing with scope variables:', capturedScope ? Object.keys(capturedScope.globalThis.raw as object).filter(k => !['api', 'builtin', 'Value', 'Date', 'Promise'].includes(k)) : 'none')
    const continueResult = await llm({
      ...opts,
      context: {
        ...context,
        history: updatedHistory,
        message: '[Continue: Now use the data you just fetched to respond to the user. The variables you declared are still in scope.]',
      },
      scope: capturedScope,
      allowContinue: false,
    })

    // Combine the code from both turns
    const continueResultRaw = continueResult.unwrap(() => {}) as { response: string, data: unknown, code: string }
    const combinedCode = `${executedCode}\n\n// --- continue ---\n\n${continueResultRaw.code}`
    const combinedValue = Value.of(
      { response: continueResultRaw.response, data: continueResultRaw.data, code: combinedCode },
      continueResult.getTaints(),
    ) as LLMResult
    combinedValue.scope = continueResult.scope

    return combinedValue
  }

  return value
}

// Combined agent system prompt - exported for use in evals
export const MOCK_AGENT_SYSTEM_PROMPT = `You are an AI assistant that helps users manage their email, calendar, Slack, files, and web browsing.

You have access to a single tool called "execute" that runs JavaScript code.

Two globals are available:
- \`api\`: All integrations (api.gmail, api.calendar, api.slack, api.filesystem, api.web)
- \`builtin\`: Agent control functions (builtin.respond, builtin.setToolCallResult)

IMPORTANT:
- You MUST use the execute tool to perform any actions.
- Use builtin.respond(message) to send a response to the user. This is the ONLY output the user will see.

THIS IS A REPL - Variables persist across turns:
- All top-level \`const\` declarations persist for the entire conversation
- You can reference variables from previous turns directly (e.g., if you defined \`const emails = ...\` before, just use \`emails\` - don't redeclare it)
- DO NOT redeclare a variable that already exists - this will error
- Only primitives, objects, arrays, and Date objects can be persisted

CONTEXT MANAGEMENT - builtin.setToolCallResult():
- setToolCallResult() saves data for your context so you can reason about it next turn
- Example for "summarize my meetings":
  Turn 1: \`const events = await api.calendar.list({...}); builtin.setToolCallResult({ events })\`
  Turn 2: \`builtin.respond("You have " + events.length + " meetings...")\`
  NOTE: \`events\` IS ONLY IN SCOPE BECAUSE YOU STORED IT WITH \`const events = ...\`
- CRITICAL: There is NO \`data\` object! Writing \`data.events\` WILL FAIL.
  WRONG: \`const events = data.events\` - this will crash!
  RIGHT: Just use the variable you declared: \`events\`

CODE RESTRICTIONS - The sandbox only supports a limited subset of JavaScript:
- ONLY use \`const\` declarations (NO \`let\`, NO \`var\`)
- NO loops (\`for\`, \`while\`, \`do-while\`) - use .map() instead
- NO function declarations (arrow functions ARE allowed as callbacks)
- NO object methods (Object.keys, Object.values, etc.)
- NO \`new\` expressions (except \`new Date()\` which is allowed)
- NO \`return\` statements - use if/else instead of early returns
- NO toString() or toLocaleString() methods
- Optional chaining (\`?.\`) IS supported for safe property access
- You CAN use: const, await, if/else, ternary operators, array indexing, property access, logical not (!)
- You CAN use array methods: .map(), .filter(), .find(), .some(), .every(), .at(), .slice(), .length
- Arrow functions work as callbacks: arr.map(x => x.id) or arr.filter(x => x.value > 10)
- For async operations on arrays, use: const results = await Promise.all(arr.map(async x => await api.something(x)))
- For dates: use \`new Date()\`, \`new Date("2024-01-15")\`, or \`new Date(timestamp)\`. Date getter methods (.toISOString(), .getFullYear(), .getMonth(), etc.) are available. Setter methods (.setHours(), .setDate(), etc.) are NOT allowed - create new Date objects instead.

When you receive previous assistant turns, you will see the code you executed and the results as comments. The variables you declared are still in scope - just use them directly by name.

MAKE SURE TO USE maxResults where requried!
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

  // Get API (real Google clients if tokens available, otherwise mock)
  const api = await getApi()

  // Load existing scope from DB (REPL persistence)
  const existingScope = thread.scope ? deserializeScope(thread.scope) : undefined

  // Use the generic llm() function
  const result = await llm({
    context: {
      system: MOCK_AGENT_SYSTEM_PROMPT,
      history,
      message,
      dts: COMBINED_DTS,
    },
    capabilities: {
      api,
    },
    policy: mockPolicy,
    outputSink: 'email',
    maxCost: 50,
    apiKey,
    scope: existingScope,
  })

  // Save the scope to DB for next turn (REPL persistence)
  const serializedScope = serializeScope(result.scope)
  await updateThreadScope(threadId, serializedScope)

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
    if (data.emails)
      mockAgent.clients.gmail.seed(data.emails)
    if (data.events)
      mockAgent.clients.calendar.seed(data.events)
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
    // Invalidate cached clients so they get recreated with new tokens
    cachedGoogleClients = null
    return true
  })

  handle('secrets:clearGoogleTokens', async () => {
    await deleteSecret('googleTokens')
    // Invalidate cached clients
    cachedGoogleClients = null
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
