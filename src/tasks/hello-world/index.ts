import type { Caps } from '../../main'

export default async ({ log, gmail }: Caps) => {
  const messages = await gmail.list({ maxResults: 5, query: 'in:inbox' })
  log(`Found ${messages.length} emails`)
  const first = await gmail.get({ id: messages[0].id })
  log(`First email: ${first.subject} from ${first.from}`)
}
