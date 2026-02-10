import { app } from 'electron'
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import path from 'node:path'
import type { DB } from './schema'
import { migrate } from './migrations'

let db: Kysely<DB> | null = null

export async function getDb(): Promise<Kysely<DB>> {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'exoagent.db')

  db = new Kysely<DB>({
    dialect: new SqliteDialect({
      database: new Database(dbPath),
    }),
  })

  await migrate(db)

  return db
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy()
    db = null
  }
}

// Re-export schema types
export type { DB } from './schema'
