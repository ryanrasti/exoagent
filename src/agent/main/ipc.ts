import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, stepCountIs, tool } from 'ai'
import { ipcMain } from 'electron'
import { codeMode } from '../../code-mode'
import { ExoAgent } from '../../policy'
import { createAuthenticatedClient, parseClientConfig, startOAuthFlow } from '../google/auth'
import { CalendarClient } from '../google/calendar'
import { GmailClient } from '../google/gmail'
import { deleteSecret, getSecret, getSecretsStatus, setSecret } from './db/secrets'

// Combined ExoAgent for both email and calendar
const agentExo = new ExoAgent(
  ['email', 'calendar'] as const,
  ['email', 'calendar'] as const,
)

// API type definitions for the LLM
const API_TYPES = `
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

  // Chat
  ipcMain.handle('chat', async (_, message: string, history: Array<{ role: 'user' | 'assistant', content: string }>) => {
    const apiKey = await getSecret('geminiApiKey')
    if (!apiKey) {
      throw new Error('API key not configured')
    }

    // Get Google clients if available
    const clientJson = await getSecret('googleOAuthClient')
    const tokensJson = await getSecret('googleTokens')

    let gmail: GmailClient | null = null
    let calendar: CalendarClient | null = null

    if (clientJson && tokensJson) {
      const tokens = JSON.parse(tokensJson)
      const authClient = createAuthenticatedClient(clientJson, tokens)
      gmail = new GmailClient(authClient)
      calendar = new CalendarClient(authClient)
    }

    const google = createGoogleGenerativeAI({ apiKey })

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

    // Build the code execution tool
    const codeTool = gmail && calendar ? codeMode({
      api: { gmail, calendar },
      policy,
      dts: API_TYPES,
      outputSink: 'email', // Default output sink
    }) : null

    const response = await generateText({
      model: google('gemini-2.0-flash'),
      messages: [
        ...history.filter(m => m.content),
        { role: 'user', content: message },
      ],
      tools: codeTool
        ? {
            execute: tool(codeTool),
          }
        : undefined,
      stopWhen: stepCountIs(10),
    })

    // Extract tool calls from steps
    const toolCalls: Array<{
      id: string
      name: string
      args: Record<string, unknown>
      result?: unknown
      error?: string
    }> = []

    for (const step of response.steps) {
      if (step.toolCalls) {
        for (const tc of step.toolCalls) {
          const toolResult = step.toolResults?.find(tr => tr.toolCallId === tc.toolCallId) as { result?: unknown, error?: unknown } | undefined
          toolCalls.push({
            id: tc.toolCallId,
            name: tc.toolName,
            args: (tc as any).input ?? {},
            result: toolResult?.result,
            error: toolResult?.error ? String(toolResult.error) : undefined,
          })
        }
      }
    }

    return { text: response.text, toolCalls }
  })
}
