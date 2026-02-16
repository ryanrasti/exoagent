import type { OAuth2Client } from 'google-auth-library'
import type { gmail_v1 } from 'googleapis'
import type { AddressObject, ParsedMail } from 'mailparser'
import { google } from 'googleapis'
import { simpleParser } from 'mailparser'
import MailComposer from 'nodemailer/lib/mail-composer'
import { z } from 'zod'
import { ExoAgent } from '../../policy'

// ExoAgent for Gmail with email as both source and sink
export const gmailExo = new ExoAgent(['email'] as const, ['email'] as const)

export interface EmailAuth {
  spf: 'pass' | 'fail' | 'none'
  dkim: 'pass' | 'fail' | 'none'
  dmarc: 'pass' | 'fail' | 'none'
  verified: boolean
}

export interface EmailPrincipals {
  from: string | undefined
  to: string[]
  cc: string[]
  all: string[]
  auth: EmailAuth
}

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
  html: string | false | undefined
  principals: EmailPrincipals
}

function parseAddresses(addr: AddressObject | AddressObject[] | undefined): string[] {
  if (!addr)
    return []
  const list = Array.isArray(addr) ? addr : [addr]
  return list.flatMap(a => a.value.map(v => v.address).filter((x): x is string => !!x))
}

function parseAuthResults(headers: ParsedMail['headers']): EmailAuth {
  const authResults = headers.get('authentication-results')
  const str = typeof authResults === 'string' ? authResults : ''

  const spf = str.includes('spf=pass') ? 'pass' : str.includes('spf=fail') ? 'fail' : 'none'
  const dkim = str.includes('dkim=pass') ? 'pass' : str.includes('dkim=fail') ? 'fail' : 'none'
  const dmarc = str.includes('dmarc=pass') ? 'pass' : str.includes('dmarc=fail') ? 'fail' : 'none'

  return {
    spf,
    dkim,
    dmarc,
    verified: spf === 'pass' && dkim === 'pass',
  }
}

// Shared schema for send/draft operations
const composeEmailSchema = z.object({
  to: z.array(z.string()),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string(),
  text: z.string(),
})

type ComposeEmailInput = z.infer<typeof composeEmailSchema>

/** Interface for Gmail operations */
export interface IGmail {
  list(opts: { maxResults: number, query: string }): Promise<Array<{ id: string, threadId: string }>>
  get(opts: { id: string }): Promise<EmailMessage>
  send(opts: { to: string[], cc?: string[], bcc?: string[], subject: string, text: string }): Promise<{ success: boolean, id: string }>
  createDraft(opts: { to: string[], cc?: string[], bcc?: string[], subject: string, text: string }): Promise<{ success: boolean, draftId: string }>
}

/** Gmail client with policy annotations for taint tracking */
export class GmailClient implements IGmail {
  private gmail: gmail_v1.Gmail

  constructor(auth: OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth })
  }

  @gmailExo.tool(z.object({
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

  // Dynamic source: email content is tainted with principals who have access
  @gmailExo.tool(z.object({ id: z.string() }), {
    source: (email: EmailMessage): ['email', { principals: string[] }] => [
      'email',
      { principals: email.principals.all },
    ],
  })
  async get({ id }: { id: string }): Promise<EmailMessage> {
    const res = await this.gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'raw',
    })

    const raw = Buffer.from(res.data.raw!, 'base64')
    const parsed = await simpleParser(raw)

    const from = parsed.from?.value[0]?.address
    const to = parseAddresses(parsed.to)
    const cc = parseAddresses(parsed.cc)
    const auth = parseAuthResults(parsed.headers)

    return {
      id: res.data.id!,
      threadId: res.data.threadId!,
      labels: res.data.labelIds || [],
      from,
      to,
      cc,
      subject: parsed.subject,
      date: parsed.date,
      text: parsed.text,
      html: parsed.html,
      principals: {
        from,
        to,
        cc,
        all: [from, ...to, ...cc].filter((x): x is string => !!x),
        auth,
      },
    }
  }

  // Dynamic sink: check recipients against incoming taints
  @gmailExo.tool(composeEmailSchema, {
    sink: ({ to, cc, bcc }: ComposeEmailInput): ['email', { principals: string[] }] => [
      'email',
      { principals: [...to, ...(cc ?? []), ...(bcc ?? [])] },
    ],
  })
  async send({ to, cc, bcc, subject, text }: ComposeEmailInput): Promise<{ success: boolean, id: string }> {
    const mail = new MailComposer({
      to: to.join(', '),
      cc: cc?.join(', '),
      bcc: bcc?.join(', '),
      subject,
      text,
    })
    const message = await mail.compile().build()
    const encoded = message.toString('base64url')

    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    })
    return { success: true, id: res.data.id! }
  }

  // Dynamic sink: drafts also need principal checks
  @gmailExo.tool(composeEmailSchema, {
    sink: ({ to, cc, bcc }: ComposeEmailInput): ['email', { principals: string[] }] => [
      'email',
      { principals: [...to, ...(cc ?? []), ...(bcc ?? [])] },
    ],
  })
  async createDraft({ to, cc, bcc, subject, text }: ComposeEmailInput): Promise<{ success: boolean, draftId: string }> {
    const mail = new MailComposer({
      to: to.join(', '),
      cc: cc?.join(', '),
      bcc: bcc?.join(', '),
      subject,
      text,
    })
    const message = await mail.compile().build()
    const encoded = message.toString('base64url')

    const res = await this.gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: encoded } },
    })
    return { success: true, draftId: res.data.id! }
  }
}

/** Default seed data for mock Gmail */
export const MOCK_GMAIL_SEED: EmailMessage[] = [
  {
    id: 'email-1',
    threadId: 'thread-1',
    labels: ['INBOX'],
    from: 'alice@example.com',
    to: ['me@example.com'],
    cc: [],
    subject: 'Hello from Alice',
    date: new Date('2024-01-15T10:00:00Z'),
    text: 'Hi there! How are you doing?',
    html: false,
    principals: {
      from: 'alice@example.com',
      to: ['me@example.com'],
      cc: [],
      all: ['alice@example.com', 'me@example.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  {
    id: 'email-2',
    threadId: 'thread-2',
    labels: ['INBOX'],
    from: 'bob@example.com',
    to: ['me@example.com'],
    cc: [],
    subject: 'Meeting tomorrow',
    date: new Date('2024-01-15T11:00:00Z'),
    text: 'Can we meet tomorrow at 2pm?',
    html: false,
    principals: {
      from: 'bob@example.com',
      to: ['me@example.com'],
      cc: [],
      all: ['bob@example.com', 'me@example.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
]

/** Mock Gmail client with in-memory state for testing */
export class MockGmailClient implements IGmail {
  private emails: Map<string, EmailMessage> = new Map()
  private drafts: Map<string, EmailMessage> = new Map()
  private nextId = 1

  constructor(seedData: EmailMessage[] = MOCK_GMAIL_SEED) {
    this.seed(seedData)
  }

  /** Seed emails for testing */
  seed(emails: EmailMessage[]): void {
    for (const email of emails) {
      this.emails.set(email.id, email)
    }
  }

  /** Get current state for assertions */
  getState(): { emails: EmailMessage[], drafts: EmailMessage[] } {
    return {
      emails: [...this.emails.values()],
      drafts: [...this.drafts.values()],
    }
  }

  /** Clear all state */
  clear(): void {
    this.emails.clear()
    this.drafts.clear()
    this.nextId = 1
  }

  @gmailExo.tool(z.object({
    maxResults: z.number(),
    query: z.string(),
  }))
  async list({ maxResults, query }: { maxResults: number, query: string }): Promise<Array<{ id: string, threadId: string }>> {
    const emails = [...this.emails.values()]
    // Simple query matching on subject/text
    const filtered = query
      ? emails.filter(e =>
          e.subject?.toLowerCase().includes(query.toLowerCase())
          || e.text?.toLowerCase().includes(query.toLowerCase()))
      : emails
    return filtered.slice(0, maxResults).map(e => ({ id: e.id, threadId: e.threadId }))
  }

  @gmailExo.tool(z.object({ id: z.string() }), {
    source: (email: EmailMessage): ['email', { principals: string[] }] => [
      'email',
      { principals: email.principals.all },
    ],
  })
  async get({ id }: { id: string }): Promise<EmailMessage> {
    const email = this.emails.get(id)
    if (!email) {
      throw new Error(`Email not found: ${id}`)
    }
    return email
  }

  @gmailExo.tool(composeEmailSchema, {
    sink: ({ to, cc, bcc }: ComposeEmailInput): ['email', { principals: string[] }] => [
      'email',
      { principals: [...to, ...(cc ?? []), ...(bcc ?? [])] },
    ],
  })
  async send({ to, cc, bcc, subject, text }: ComposeEmailInput): Promise<{ success: boolean, id: string }> {
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
      html: undefined,
      principals: {
        from: 'me@example.com',
        to,
        cc: cc ?? [],
        all: ['me@example.com', ...to, ...(cc ?? [])],
        auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
      },
    }
    this.emails.set(id, email)
    return { success: true, id }
  }

  @gmailExo.tool(composeEmailSchema, {
    sink: ({ to, cc, bcc }: ComposeEmailInput): ['email', { principals: string[] }] => [
      'email',
      { principals: [...to, ...(cc ?? []), ...(bcc ?? [])] },
    ],
  })
  async createDraft({ to, cc, bcc, subject, text }: ComposeEmailInput): Promise<{ success: boolean, draftId: string }> {
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
      html: undefined,
      principals: {
        from: 'me@example.com',
        to,
        cc: cc ?? [],
        all: ['me@example.com', ...to, ...(cc ?? [])],
        auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
      },
    }
    this.drafts.set(draftId, email)
    return { success: true, draftId }
  }
}
