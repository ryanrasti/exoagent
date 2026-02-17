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
  // Boss email - urgent action needed (workflow: email triage)
  {
    id: 'email-1',
    threadId: 'thread-1',
    labels: ['INBOX', 'IMPORTANT'],
    from: 'boss@company.com',
    to: ['me@example.com'],
    cc: [],
    subject: 'Q4 Report Review - Need by EOD',
    date: new Date('2024-01-15T08:00:00Z'),
    text: 'Hi,\n\nPlease review the Q4 report and send me your comments by end of day. The board meeting is tomorrow.\n\nThanks,\nSarah',
    html: false,
    principals: {
      from: 'boss@company.com',
      to: ['me@example.com'],
      cc: [],
      all: ['boss@company.com', 'me@example.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  // Meeting request with specific time (workflow: email → calendar)
  {
    id: 'email-2',
    threadId: 'thread-2',
    labels: ['INBOX'],
    from: 'alice@example.com',
    to: ['me@example.com'],
    cc: ['bob@example.com'],
    subject: 'Project sync - Thursday 2pm?',
    date: new Date('2024-01-15T09:30:00Z'),
    text: 'Hey!\n\nCan we do a quick sync on the project? How about Thursday at 2pm Pacific? We can use my Zoom: https://zoom.us/j/123456789\n\nAlice',
    html: false,
    principals: {
      from: 'alice@example.com',
      to: ['me@example.com'],
      cc: ['bob@example.com'],
      all: ['alice@example.com', 'me@example.com', 'bob@example.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  // Newsletter (workflow: email triage - low priority)
  {
    id: 'email-3',
    threadId: 'thread-3',
    labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
    from: 'newsletter@techdigest.com',
    to: ['me@example.com'],
    cc: [],
    subject: 'This Week in AI: Top 10 Breakthroughs',
    date: new Date('2024-01-15T06:00:00Z'),
    text: 'Your weekly AI digest:\n\n1. New language model achieves...\n2. Robotics breakthrough...\n\nUnsubscribe: https://techdigest.com/unsub',
    html: false,
    principals: {
      from: 'newsletter@techdigest.com',
      to: ['me@example.com'],
      cc: [],
      all: ['newsletter@techdigest.com', 'me@example.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  // Team update worth forwarding to Slack (workflow: email → slack relay)
  {
    id: 'email-4',
    threadId: 'thread-4',
    labels: ['INBOX'],
    from: 'devops@company.com',
    to: ['engineering-team@company.com'],
    cc: ['me@example.com'],
    subject: 'Production deployment scheduled - Friday 6pm',
    date: new Date('2024-01-15T14:00:00Z'),
    text: 'Team,\n\nWe will be deploying v2.5.0 to production on Friday at 6pm PST.\n\nKey changes:\n- New auth system\n- Performance improvements\n- Bug fixes for checkout flow\n\nPlease ensure your changes are merged by Thursday EOD.\n\n- DevOps Team',
    html: false,
    principals: {
      from: 'devops@company.com',
      to: ['engineering-team@company.com'],
      cc: ['me@example.com'],
      all: ['devops@company.com', 'engineering-team@company.com', 'me@example.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  // Client email requiring response (workflow: email triage)
  {
    id: 'email-5',
    threadId: 'thread-5',
    labels: ['INBOX'],
    from: 'john.smith@clientcorp.com',
    to: ['me@example.com'],
    cc: ['sales@company.com'],
    subject: 'RE: Contract renewal discussion',
    date: new Date('2024-01-15T11:00:00Z'),
    text: 'Hi,\n\nThanks for sending over the proposal. We have a few questions:\n\n1. Can we get a 15% discount for a 2-year commitment?\n2. Is 24/7 support included?\n3. What are the SLA guarantees?\n\nLooking forward to your response.\n\nBest,\nJohn Smith\nClientCorp',
    html: false,
    principals: {
      from: 'john.smith@clientcorp.com',
      to: ['me@example.com'],
      cc: ['sales@company.com'],
      all: ['john.smith@clientcorp.com', 'me@example.com', 'sales@company.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  // Personal email (workflow: email triage - personal)
  {
    id: 'email-6',
    threadId: 'thread-6',
    labels: ['INBOX'],
    from: 'mom@family.com',
    to: ['me@example.com'],
    cc: [],
    subject: 'Dinner Sunday?',
    date: new Date('2024-01-15T12:00:00Z'),
    text: 'Hi sweetie!\n\nAre you free for dinner on Sunday? Dad wants to try that new Italian place downtown. Let me know!\n\nLove,\nMom',
    html: false,
    principals: {
      from: 'mom@family.com',
      to: ['me@example.com'],
      cc: [],
      all: ['mom@family.com', 'me@example.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  // Expense report (workflow: cross-app automation)
  {
    id: 'email-7',
    threadId: 'thread-7',
    labels: ['INBOX'],
    from: 'expenses@company.com',
    to: ['me@example.com'],
    cc: [],
    subject: 'Expense report approved - $450.00',
    date: new Date('2024-01-15T13:00:00Z'),
    text: 'Your expense report #EXP-2024-0115 for $450.00 has been approved.\n\nItems:\n- Flight to SF: $320.00\n- Uber to office: $45.00\n- Team lunch: $85.00\n\nReimbursement will be processed in the next payroll cycle.',
    html: false,
    principals: {
      from: 'expenses@company.com',
      to: ['me@example.com'],
      cc: [],
      all: ['expenses@company.com', 'me@example.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  // ClientCorp thread - multiple emails for thread summarization (#16) and meeting prep (#7)
  {
    id: 'email-8',
    threadId: 'thread-5', // Same thread as email-5
    labels: ['SENT'],
    from: 'me@example.com',
    to: ['john.smith@clientcorp.com'],
    cc: ['sales@company.com'],
    subject: 'RE: Contract renewal discussion',
    date: new Date('2024-01-14T10:00:00Z'),
    text: 'Hi John,\n\nGreat to hear from you! I\'ve attached our proposal for the renewal.\n\nKey points:\n- 2-year term with favorable pricing\n- Enterprise support tier\n- 99.9% SLA\n\nLet me know if you have questions.\n\nBest,\nMe',
    html: false,
    principals: {
      from: 'me@example.com',
      to: ['john.smith@clientcorp.com'],
      cc: ['sales@company.com'],
      all: ['me@example.com', 'john.smith@clientcorp.com', 'sales@company.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  {
    id: 'email-9',
    threadId: 'thread-5', // Same thread
    labels: ['INBOX'],
    from: 'john.smith@clientcorp.com',
    to: ['me@example.com'],
    cc: ['sales@company.com', 'jane.doe@clientcorp.com'],
    subject: 'RE: Contract renewal discussion',
    date: new Date('2024-01-13T15:00:00Z'),
    text: 'Hi,\n\nWe\'re interested in renewing. Can you send over the proposal? Adding Jane from our legal team.\n\nThanks,\nJohn',
    html: false,
    principals: {
      from: 'john.smith@clientcorp.com',
      to: ['me@example.com'],
      cc: ['sales@company.com', 'jane.doe@clientcorp.com'],
      all: ['john.smith@clientcorp.com', 'me@example.com', 'sales@company.com', 'jane.doe@clientcorp.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  {
    id: 'email-10',
    threadId: 'thread-5', // Same thread - original outreach
    labels: ['SENT'],
    from: 'me@example.com',
    to: ['john.smith@clientcorp.com'],
    cc: [],
    subject: 'Contract renewal discussion',
    date: new Date('2024-01-12T09:00:00Z'),
    text: 'Hi John,\n\nI wanted to reach out about your upcoming contract renewal. Your current agreement expires Feb 28.\n\nWould you have time this week to discuss options?\n\nBest,\nMe',
    html: false,
    principals: {
      from: 'me@example.com',
      to: ['john.smith@clientcorp.com'],
      cc: [],
      all: ['me@example.com', 'john.smith@clientcorp.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  // Incident emails (#30 - incident summary)
  {
    id: 'email-11',
    threadId: 'thread-8',
    labels: ['INBOX', 'IMPORTANT'],
    from: 'oncall@company.com',
    to: ['engineering-team@company.com'],
    cc: [],
    subject: '[INCIDENT] Production database degradation',
    date: new Date('2024-01-15T15:30:00Z'),
    text: 'INCIDENT DECLARED\n\nSeverity: P1\nImpact: Elevated latency on all read operations\nStarted: 15:25 PST\n\nDatabase replica lag detected. Investigating root cause.\n\nIncident Commander: Alice\nComms: Bob',
    html: false,
    principals: {
      from: 'oncall@company.com',
      to: ['engineering-team@company.com'],
      cc: [],
      all: ['oncall@company.com', 'engineering-team@company.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  {
    id: 'email-12',
    threadId: 'thread-8',
    labels: ['INBOX'],
    from: 'oncall@company.com',
    to: ['engineering-team@company.com'],
    cc: [],
    subject: 'RE: [INCIDENT] Production database degradation',
    date: new Date('2024-01-15T16:00:00Z'),
    text: 'UPDATE\n\nRoot cause identified: Connection pool exhaustion from runaway query.\n\nMitigation: Killed offending queries, scaling up connection pool.\n\nETA to resolution: 15 minutes',
    html: false,
    principals: {
      from: 'oncall@company.com',
      to: ['engineering-team@company.com'],
      cc: [],
      all: ['oncall@company.com', 'engineering-team@company.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  {
    id: 'email-13',
    threadId: 'thread-8',
    labels: ['INBOX'],
    from: 'oncall@company.com',
    to: ['engineering-team@company.com'],
    cc: [],
    subject: 'RE: [INCIDENT] Production database degradation - RESOLVED',
    date: new Date('2024-01-15T16:20:00Z'),
    text: 'RESOLVED\n\nIncident duration: 55 minutes\nImpact: ~2000 users experienced slow load times\nRoot cause: Inefficient query in new feature release\n\nFollow-up:\n- Post-mortem scheduled for tomorrow 10am\n- Query optimization PR in progress\n\nThanks everyone for the quick response.',
    html: false,
    principals: {
      from: 'oncall@company.com',
      to: ['engineering-team@company.com'],
      cc: [],
      all: ['oncall@company.com', 'engineering-team@company.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
  // Project handoff email (#28)
  {
    id: 'email-14',
    threadId: 'thread-9',
    labels: ['INBOX'],
    from: 'alice@example.com',
    to: ['me@example.com'],
    cc: ['bob@example.com'],
    subject: 'Project Atlas handoff materials',
    date: new Date('2024-01-15T10:00:00Z'),
    text: 'Hi,\n\nAs discussed, I\'m transitioning Project Atlas to you. Here\'s what you need to know:\n\n- GitHub: /company/project-atlas\n- Confluence: /wiki/atlas\n- Key contacts: Bob (backend), Charlie (design)\n- Current sprint ends Friday\n- Main blocker: API rate limiting issue\n\nLet\'s sync tomorrow to walk through the codebase.\n\nAlice',
    html: false,
    principals: {
      from: 'alice@example.com',
      to: ['me@example.com'],
      cc: ['bob@example.com'],
      all: ['alice@example.com', 'me@example.com', 'bob@example.com'],
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', verified: true },
    },
  },
]

/** Type definitions for LLM */
export const GMAIL_DTS = `
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

interface Gmail {
  /** List emails matching a query */
  list(opts: { maxResults: number, query: string }): Promise<Array<{ id: string, threadId: string }>>

  /** Get a specific email by ID */
  get(opts: { id: string }): Promise<EmailMessage>

  /** Send an email */
  send(opts: { to: string[], cc?: string[], bcc?: string[], subject: string, text: string }): Promise<{ success: boolean, id: string }>

  /** Create a draft email */
  createDraft(opts: { to: string[], cc?: string[], bcc?: string[], subject: string, text: string }): Promise<{ success: boolean, draftId: string }>
}
`

/** Mock Gmail client with in-memory state for testing */
export class MockGmailClient implements IGmail {
  static dts = GMAIL_DTS
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
    // Handle Gmail-style queries - for mock, just return all inbox emails
    // Real queries like "is:unread", "in:inbox" are not filtered in mock
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
