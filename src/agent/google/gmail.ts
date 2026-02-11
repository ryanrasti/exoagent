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

/** Gmail client with policy annotations for taint tracking */
export class GmailClient {
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
