import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  console.log('[migrate:003_scope] Starting migration...')

  // Add scope column to threads for REPL persistence
  await db.schema
    .alterTable('threads')
    .addColumn('scope', 'text')
    .execute()

  console.log('[migrate:003_scope] Migration complete')
}

export async function down(db: Kysely<any>): Promise<void> {
  // SQLite doesn't support DROP COLUMN easily, so we skip the down migration
  console.log('[migrate:003_scope] Down migration skipped (SQLite limitation)')
}
