import { google, gmail_v1 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type Mail from 'nodemailer/lib/mailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { simpleParser, ParsedMail, AddressObject } from 'mailparser'

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

function parseAddresses(addr: AddressObject | AddressObject[] | undefined): string[] {
  if (!addr) return []
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

export class GmailClient {
  private gmail: gmail_v1.Gmail

  constructor(auth: OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth })
  }

  async list(maxResults = 10, query = 'in:inbox'): Promise<Array<{ id: string; threadId: string }>> {
    const res = await this.gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query,
    })
    return res.data.messages || []
  }

  async get(id: string): Promise<ParsedMail & { id: string; threadId: string; labels: string[]; principals: EmailPrincipals }> {
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
      ...parsed,
      id: res.data.id!,
      threadId: res.data.threadId!,
      labels: res.data.labelIds || [],
      principals: {
        from,
        to,
        cc,
        all: [from, ...to, ...cc].filter((x): x is string => !!x),
        auth,
      },
    }
  }

  async send(options: Mail.Options): Promise<string> {
    const raw = await this.encode(options)
    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    })
    return res.data.id!
  }

  async createDraft(options: Mail.Options): Promise<string> {
    const raw = await this.encode(options)
    const res = await this.gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw } },
    })
    return res.data.id!
  }

  private async encode(options: Mail.Options): Promise<string> {
    const mail = new MailComposer(options)
    const message = await mail.compile().build()
    return message.toString('base64url')
  }
}
