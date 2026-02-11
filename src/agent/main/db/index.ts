import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import path from 'node:path'
import os from 'node:os'
import type { DB } from './schema'
import { migrate } from './migrations'

let db: Kysely<DB> | null = null

function getDbPath(): string {
  // Try to use electron app path if available
  try {
    const { app } = require('electron')
    return path.join(app.getPath('userData'), 'exoagent.db')
  }
  catch {
    // Fallback for non-electron (dev mode)
    return path.join(os.homedir(), '.config', 'exoagent', 'exoagent.db')
  }
}

export async function getDb(): Promise<Kysely<DB>> {
  if (db) return db

  const dbPath = getDbPath()

  // Ensure directory exists
  const fs = await import('node:fs/promises')
  await fs.mkdir(path.dirname(dbPath), { recursive: true })

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
