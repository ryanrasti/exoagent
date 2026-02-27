import type { gmail_v1 } from 'googleapis'
import type { Auth } from 'googleapis'
import { google } from 'googleapis'
import { z } from 'zod'
import { tool } from '../../exoeval/tool'

export interface EmailMessage {
  id: string
  threadId: string
  labels: string[]
  from: string | undefined
  to: string[]
  cc: string[]
  subject: string | undefined
  date: Date | undefined
  text: string | undefined
}

/** Interface for Gmail operations */
export interface IGmail {
  list(opts: { maxResults: number, query: string }): Promise<Array<{ id: string, threadId: string }>>
  get(opts: { id: string }): Promise<EmailMessage>
  send(opts: { to: string[], cc?: string[], bcc?: string[], subject: string, text: string }): Promise<{ success: boolean, id: string }>
  createDraft(opts: { to: string[], cc?: string[], bcc?: string[], subject: string, text: string }): Promise<{ success: boolean, draftId: string }>
}

const composeEmailSchema = z.object({
  to: z.array(z.string()),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string(),
  text: z.string(),
})

type ComposeEmailInput = z.infer<typeof composeEmailSchema>

export const MOCK_SEED: EmailMessage[] = [
  {
    id: 'email-1',
    threadId: 'thread-1',
    labels: ['INBOX', 'IMPORTANT'],
    from: 'boss@company.com',
    to: ['me@example.com'],
    cc: [],
    subject: 'Q4 Report Review - Need by EOD',
    date: new Date('2024-01-15T08:00:00Z'),
    text: 'Please review the Q4 report and send me your comments by end of day. The board meeting is tomorrow.',
  },
  {
    id: 'email-2',
    threadId: 'thread-2',
    labels: ['INBOX'],
    from: 'alice@example.com',
    to: ['me@example.com'],
    cc: ['bob@example.com'],
    subject: 'Project sync - Thursday 2pm?',
    date: new Date('2024-01-15T09:30:00Z'),
    text: 'Can we do a quick sync on the project? How about Thursday at 2pm Pacific?',
  },
  {
    id: 'email-3',
    threadId: 'thread-3',
    labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
    from: 'newsletter@techdigest.com',
    to: ['me@example.com'],
    cc: [],
    subject: 'This Week in AI: Top 10 Breakthroughs',
    date: new Date('2024-01-15T06:00:00Z'),
    text: 'Your weekly AI digest:\n\n1. New language model achieves...\n2. Robotics breakthrough...',
  },
  {
    id: 'email-4',
    threadId: 'thread-4',
    labels: ['INBOX'],
    from: 'devops@company.com',
    to: ['engineering-team@company.com'],
    cc: ['me@example.com'],
    subject: 'Production deployment scheduled - Friday 6pm',
    date: new Date('2024-01-15T14:00:00Z'),
    text: 'We will be deploying v2.5.0 to production on Friday at 6pm PST.\n\nKey changes:\n- New auth system\n- Performance improvements\n- Bug fixes for checkout flow',
  },
  {
    id: 'email-5',
    threadId: 'thread-5',
    labels: ['INBOX'],
    from: 'mom@family.com',
    to: ['me@example.com'],
    cc: [],
    subject: 'Dinner Sunday?',
    date: new Date('2024-01-15T12:00:00Z'),
    text: 'Are you free for dinner on Sunday? Dad wants to try that new Italian place downtown.',
  },
]

/** Real Gmail client using Google APIs */
export class GmailClient implements IGmail {
  private gmail: gmail_v1.Gmail

  constructor(auth: Auth.OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth })
  }

  @tool(z.object({
    maxResults: z.number(),
    query: z.string(),
  }))
  async list({ maxResults, query }: { maxResults: number, query: string }): Promise<Array<{ id: string, threadId: string }>> {
    const res = await this.gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query,
    })
    return (res.data.messages || []).map(m => ({ id: m.id!, threadId: m.threadId! }))
  }

  @tool(z.object({ id: z.string() }))
  async get({ id }: { id: string }): Promise<EmailMessage> {
    const res = await this.gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full',
    })

    const headers = res.data.payload?.headers || []
    const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value

    const from = getHeader('from')
    const to = getHeader('to')?.split(',').map(s => s.trim()) || []
    const cc = getHeader('cc')?.split(',').map(s => s.trim()) || []
    const subject = getHeader('subject')
    const dateStr = getHeader('date')

    // Extract text body
    let text: string | undefined
    const payload = res.data.payload
    if (payload?.body?.data) {
      text = Buffer.from(payload.body.data, 'base64').toString('utf-8')
    }
    else if (payload?.parts) {
      const textPart = payload.parts.find(p => p.mimeType === 'text/plain')
      if (textPart?.body?.data) {
        text = Buffer.from(textPart.body.data, 'base64').toString('utf-8')
      }
    }

    return {
      id: res.data.id!,
      threadId: res.data.threadId!,
      labels: res.data.labelIds || [],
      from: from ?? undefined,
      to,
      cc,
      subject: subject ?? undefined,
      date: dateStr ? new Date(dateStr) : undefined,
      text,
    }
  }

  @tool(composeEmailSchema)
  async send({ to, cc, bcc, subject, text }: ComposeEmailInput): Promise<{ success: boolean, id: string }> {
    const message = this.createMimeMessage({ to, cc, bcc, subject, text })
    const encoded = Buffer.from(message).toString('base64url')

    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    })
    return { success: true, id: res.data.id! }
  }

  @tool(composeEmailSchema)
  async createDraft({ to, cc, bcc, subject, text }: ComposeEmailInput): Promise<{ success: boolean, draftId: string }> {
    const message = this.createMimeMessage({ to, cc, bcc, subject, text })
    const encoded = Buffer.from(message).toString('base64url')

    const res = await this.gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: encoded } },
    })
    return { success: true, draftId: res.data.id! }
  }

  private createMimeMessage({ to, cc, bcc, subject, text }: ComposeEmailInput): string {
    const lines = [
      `To: ${to.join(', ')}`,
      cc?.length ? `Cc: ${cc.join(', ')}` : '',
      bcc?.length ? `Bcc: ${bcc.join(', ')}` : '',
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
    ].filter(Boolean)
    return lines.join('\r\n')
  }
}

export class MockGmailClient implements IGmail {
  private emails: Map<string, EmailMessage> = new Map()
  private drafts: Map<string, EmailMessage> = new Map()
  private nextId = 1

  constructor(seedData: EmailMessage[] = MOCK_SEED) {
    for (const email of seedData) {
      this.emails.set(email.id, email)
    }
  }

  @tool(z.object({
    maxResults: z.number(),
    query: z.string(),
  }))
  async list({ maxResults, query }: { maxResults: number, query: string }): Promise<Array<{ id: string, threadId: string }>> {
    const emails = [...this.emails.values()]
    const isGmailQuery = query.includes(':')
    const filtered = isGmailQuery
      ? emails.filter(e => e.labels.includes('INBOX'))
      : query
        ? emails.filter(e =>
            e.subject?.toLowerCase().includes(query.toLowerCase())
            || e.text?.toLowerCase().includes(query.toLowerCase()))
        : emails
    return filtered.slice(0, maxResults).map(e => ({ id: e.id, threadId: e.threadId }))
  }

  @tool(z.object({ id: z.string() }))
  async get({ id }: { id: string }): Promise<EmailMessage> {
    const email = this.emails.get(id)
    if (!email) {
      throw new Error(`Email not found: ${id}`)
    }
    return email
  }

  @tool(composeEmailSchema)
  async send({ to, cc, bcc: _bcc, subject, text }: ComposeEmailInput): Promise<{ success: boolean, id: string }> {
    const id = `msg-${this.nextId++}`
    const email: EmailMessage = {
      id,
      threadId: `thread-${id}`,
      labels: ['SENT'],
      from: 'me@example.com',
      to,
      cc: cc ?? [],
      subject,
      date: new Date(),
      text,
    }
    this.emails.set(id, email)
    return { success: true, id }
  }

  @tool(composeEmailSchema)
  async createDraft({ to, cc, bcc: _bcc, subject, text }: ComposeEmailInput): Promise<{ success: boolean, draftId: string }> {
    const draftId = `draft-${this.nextId++}`
    const email: EmailMessage = {
      id: draftId,
      threadId: `thread-${draftId}`,
      labels: ['DRAFT'],
      from: 'me@example.com',
      to,
      cc: cc ?? [],
      subject,
      date: new Date(),
      text,
    }
    this.drafts.set(draftId, email)
    return { success: true, draftId }
  }
}
