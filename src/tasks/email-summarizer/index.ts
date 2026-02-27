import type { Caps } from '../../main'

export interface EmailSummary {
  id: string
  from: string
  subject: string
  priority: 'high' | 'medium' | 'low'
  summary: string
  actionRequired: boolean
  suggestedAction?: string
}

export default async ({ log, gmail, llm }: Caps): Promise<EmailSummary[]> => {
  const messages = await gmail.list({ maxResults: 10, query: 'in:inbox is:unread' })
  log(`Found ${messages.length} unread emails`)

  if (messages.length === 0) {
    log('No unread emails to summarize')
    return []
  }

  // Process each email and collect summaries using map + Promise.all
  const summaries = await Promise.all(
    messages.map(async (msg) => {
      const email = await gmail.get({ id: msg.id })
      log(`Processing: ${email.subject}`)

      const prompt = `Analyze this email and provide a JSON response:

From: ${email.from}
Subject: ${email.subject}
Date: ${email.date ?? 'unknown'}
Body:
${email.text?.slice(0, 2000) ?? '(no text content)'}

Respond with ONLY valid JSON (no markdown):
{
  "priority": "high" | "medium" | "low",
  "summary": "1-2 sentence summary",
  "actionRequired": true | false,
  "suggestedAction": "what to do (if action required)"
}`

      const response = await llm.ask({
        prompt,
        system: 'You are an email assistant. Analyze emails and respond with valid JSON only.',
      })

      const parsed = JSON.parse(response)
      return {
        id: email.id,
        from: email.from ?? 'unknown',
        subject: email.subject ?? '(no subject)',
        priority: parsed.priority,
        summary: parsed.summary,
        actionRequired: parsed.actionRequired,
        suggestedAction: parsed.suggestedAction,
      } as EmailSummary
    }),
  )

  // Log summary
  log('\n--- Email Summary ---')
  summaries.forEach((s) => {
    const flag = s.actionRequired ? '⚠️' : '•'
    log(`${flag} [${s.priority.toUpperCase()}] ${s.subject}`)
    log(`  From: ${s.from}`)
    log(`  ${s.summary}`)
    if (s.suggestedAction) {
      log(`  → ${s.suggestedAction}`)
    }
  })

  return summaries
}
