import type { Kysely } from 'kysely'

export async function migrate(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('secrets')
    .ifNotExists()
    .addColumn('key', 'text', col => col.primaryKey().notNull())
    .addColumn('value', 'text', col => col.notNull())
    .addColumn('created_at', 'integer', col => col.defaultTo(Date.now()))
    .addColumn('updated_at', 'integer', col => col.defaultTo(Date.now()))
    .execute()

  await db.schema
    .createTable('config')
    .ifNotExists()
    .addColumn('key', 'text', col => col.primaryKey().notNull())
    .addColumn('value', 'text', col => col.notNull())
    .addColumn('created_at', 'integer', col => col.defaultTo(Date.now()))
    .addColumn('updated_at', 'integer', col => col.defaultTo(Date.now()))
    .execute()

  await db.schema
    .createTable('flows')
    .ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey().notNull())
    .addColumn('parent_id', 'text', col => col.references('flows.id'))
    .addColumn('title', 'text')
    .addColumn('taints', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('status', 'text', col => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'integer', col => col.defaultTo(Date.now()))
    .addColumn('updated_at', 'integer', col => col.defaultTo(Date.now()))
    .execute()

  await db.schema
    .createTable('messages')
    .ifNotExists()
    .addColumn('id', 'text', col => col.primaryKey().notNull())
    .addColumn('flow_id', 'text', col => col.notNull().references('flows.id'))
    .addColumn('role', 'text', col => col.notNull())
    .addColumn('content', 'text', col => col.notNull())
    .addColumn('taints', 'text', col => col.notNull().defaultTo('[]'))
    .addColumn('created_at', 'integer', col => col.defaultTo(Date.now()))
    .execute()

  // Indexes
  await db.schema
    .createIndex('idx_messages_flow_id')
    .ifNotExists()
    .on('messages')
    .column('flow_id')
    .execute()

  await db.schema
    .createIndex('idx_flows_parent_id')
    .ifNotExists()
    .on('flows')
    .column('parent_id')
    .execute()
}
