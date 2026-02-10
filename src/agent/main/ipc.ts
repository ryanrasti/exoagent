import { ipcMain } from 'electron'
import { generateText, tool, zodSchema, stepCountIs } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import { getSecret, setSecret, deleteSecret, getSecretsStatus } from './db/secrets'
import { parseClientConfig, startOAuthFlow, createAuthenticatedClient } from '../google/auth'
import { GmailClient } from '../google/gmail'
import { CalendarClient } from '../google/calendar'

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
  ipcMain.handle('chat', async (_, message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) => {
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

    const response = await generateText({
      model: google('gemini-2.0-flash'),
      messages: [
        ...history.filter(m => m.content),
        { role: 'user', content: message },
      ],
      tools: gmail && calendar ? {
        listEmails: tool({
          description: 'List emails from Gmail inbox',
          inputSchema: zodSchema(z.object({
            maxResults: z.number().describe('Maximum number of emails to return'),
            query: z.string().describe('Gmail search query'),
          })),
          execute: async ({ maxResults, query }) => {
            const messages = await gmail.list(maxResults, query)
            const emails = await Promise.all(
              messages.slice(0, 5).map(async m => {
                const full = await gmail.get(m.id)
                return {
                  id: full.id,
                  from: full.from?.text,
                  subject: full.subject,
                  date: full.date?.toISOString(),
                  snippet: full.text?.slice(0, 200),
                }
              })
            )
            return emails
          },
        }),
        getEmail: tool({
          description: 'Get full email content by ID',
          inputSchema: zodSchema(z.object({
            id: z.string().describe('Email ID'),
          })),
          execute: async ({ id }) => {
            const email = await gmail.get(id)
            return {
              id: email.id,
              from: email.from?.text,
              to: email.to?.text,
              subject: email.subject,
              date: email.date?.toISOString(),
              text: email.text,
              html: email.html,
            }
          },
        }),
        sendEmail: tool({
          description: 'Send an email',
          inputSchema: zodSchema(z.object({
            to: z.string().describe('Recipient email address'),
            subject: z.string().describe('Email subject'),
            text: z.string().describe('Email body (plain text)'),
          })),
          execute: async ({ to, subject, text }) => {
            const id = await gmail.send({ to, subject, text })
            return { success: true, id }
          },
        }),
        createDraft: tool({
          description: 'Create an email draft',
          inputSchema: zodSchema(z.object({
            to: z.string().describe('Recipient email address'),
            subject: z.string().describe('Email subject'),
            text: z.string().describe('Email body (plain text)'),
          })),
          execute: async ({ to, subject, text }) => {
            const id = await gmail.createDraft({ to, subject, text })
            return { success: true, draftId: id }
          },
        }),
        listEvents: tool({
          description: 'List upcoming calendar events',
          inputSchema: zodSchema(z.object({
            maxResults: z.number().describe('Maximum number of events'),
            timeMin: z.string().describe('Start time ISO string'),
            timeMax: z.string().nullable().describe('End time ISO string, or null for no limit'),
          })),
          execute: async ({ maxResults, timeMin, timeMax }) => {
            const events = await calendar.list({
              maxResults,
              timeMin: timeMin ? new Date(timeMin) : undefined,
              timeMax: timeMax ? new Date(timeMax) : undefined,
            })
            return events.map(e => ({
              id: e.id,
              summary: e.summary,
              start: e.start?.dateTime || e.start?.date,
              end: e.end?.dateTime || e.end?.date,
              location: e.location,
            }))
          },
        }),
        createEvent: tool({
          description: 'Create a calendar event',
          inputSchema: zodSchema(z.object({
            summary: z.string().describe('Event title'),
            start: z.string().describe('Start time ISO string'),
            end: z.string().describe('End time ISO string'),
            description: z.string().describe('Event description'),
            location: z.string().describe('Event location'),
          })),
          execute: async ({ summary, start, end, description, location }) => {
            const event = await calendar.create({
              summary,
              description,
              location,
              start: { dateTime: start },
              end: { dateTime: end },
            })
            return { success: true, id: event.id, htmlLink: event.htmlLink }
          },
        }),
        quickAddEvent: tool({
          description: 'Quickly add event using natural language (e.g., "Meeting tomorrow at 3pm")',
          inputSchema: zodSchema(z.object({
            text: z.string().describe('Natural language event description'),
          })),
          execute: async ({ text }) => {
            const event = await calendar.quickAdd(text)
            return { success: true, id: event.id, summary: event.summary, htmlLink: event.htmlLink }
          },
        }),
      } : undefined,
      stopWhen: stepCountIs(5),
    })

    return response.text
  })
}
