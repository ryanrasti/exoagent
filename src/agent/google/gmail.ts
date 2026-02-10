import { google, gmail_v1 } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type Mail from 'nodemailer/lib/mailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { simpleParser, ParsedMail } from 'mailparser'

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

  async get(id: string): Promise<ParsedMail & { id: string; threadId: string; labels: string[] }> {
    const res = await this.gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'raw',
    })

    const raw = Buffer.from(res.data.raw!, 'base64')
    const parsed = await simpleParser(raw)

    return {
      ...parsed,
      id: res.data.id!,
      threadId: res.data.threadId!,
      labels: res.data.labelIds || [],
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
