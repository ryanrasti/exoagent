import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  console.log('[migrate:002_subthreads] Starting migration...')

  // Add parent_id for subthread hierarchy (null = main thread)
  await db.schema
    .alterTable('threads')
    .addColumn('parent_id', 'text', col => col.references('threads.id'))
    .execute()

  // Add taints accumulated by this thread (JSON array)
  await db.schema
    .alterTable('threads')
    .addColumn('taints', 'text', col => col.notNull().defaultTo('[]'))
    .execute()

  // Index for fast subthread lookups
  await db.schema
    .createIndex('idx_threads_parent_id')
    .on('threads')
    .column('parent_id')
    .execute()

  console.log('[migrate:002_subthreads] Migration complete')
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_threads_parent_id').execute()
  await db.schema.alterTable('threads').dropColumn('taints').execute()
  await db.schema.alterTable('threads').dropColumn('parent_id').execute()
}
