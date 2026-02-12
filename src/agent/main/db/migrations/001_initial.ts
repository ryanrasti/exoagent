import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  console.log('[migrate:001_initial] Starting migration...')

  await db.schema
    .createTable('secrets')
    .ifNotExists()
    .addColumn('key', 'text', col => col.primaryKey().notNull())
    .addColumn('value', 'text', col => col.notNull())
    .addColumn('created_at', 'integer')
    .addColumn('updated_at', 'integer')
    .execute()

  await db.schema
    .createTable('config')
    .ifNotExists()
    .addColumn('key', 'text', col => col.primaryKey().notNull())
    .addColumn('value', 'text', col => col.notNull())
    .addColumn('created_at', 'integer')
    .addColumn('updated_at', 'integer')
    .execute()

  await db.schema
    .createTable('threads')
    .ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey().notNull())
    .addColumn('title', 'text')
    .addColumn('pinned', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'integer')
    .addColumn('updated_at', 'integer')
    .execute()

  await db.schema
    .createTable('messages')
    .ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey().notNull())
    .addColumn('thread_id', 'text', col => col.notNull().references('threads.id'))
    .addColumn('role', 'text', col => col.notNull())
    .addColumn('content', 'text', col => col.notNull())
    .addColumn('data', 'text')
    .addColumn('taints', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('code', 'text')
    .addColumn('created_at', 'integer')
    .execute()

  await db.schema
    .createIndex('idx_messages_thread_id')
    .ifNotExists()
    .on('messages')
    .column('thread_id')
    .execute()

  console.log('[migrate:001_initial] Migration complete')
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('messages').execute()
  await db.schema.dropTable('threads').execute()
  await db.schema.dropTable('config').execute()
  await db.schema.dropTable('secrets').execute()
}
