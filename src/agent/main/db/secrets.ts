import { getDb } from './index'

export async function getSecret(key: string): Promise<string | null> {
  const db = await getDb()
  const row = await db
    .selectFrom('secrets')
    .select('value')
    .where('key', '=', key)
    .executeTakeFirst()
  return row?.value ?? null
}

export async function setSecret(key: string, value: string): Promise<void> {
  const db = await getDb()
  const now = Date.now()
  await db
    .insertInto('secrets')
    .values({ key, value, created_at: now, updated_at: now })
    .onConflict(oc => oc.column('key').doUpdateSet({ value, updated_at: now }))
    .execute()
}

export async function hasSecret(key: string): Promise<boolean> {
  const db = await getDb()
  const row = await db
    .selectFrom('secrets')
    .select('key')
    .where('key', '=', key)
    .executeTakeFirst()
  return row != null
}

export async function deleteSecret(key: string): Promise<void> {
  const db = await getDb()
  await db.deleteFrom('secrets').where('key', '=', key).execute()
}

export async function getSecretsStatus(): Promise<Record<string, boolean>> {
  const db = await getDb()
  const rows = await db.selectFrom('secrets').select('key').execute()
  const keys = new Set(rows.map(r => r.key))
  return {
    geminiApiKey: keys.has('geminiApiKey'),
    googleOAuthClient: keys.has('googleOAuthClient'),
  }
}
