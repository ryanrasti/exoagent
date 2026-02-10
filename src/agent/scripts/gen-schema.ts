#!/usr/bin/env npx tsx
import { Kysely, SqliteDialect as KyselySqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { generate, SqliteDialect } from 'kysely-codegen'
import { migrate } from '../main/db/migrations'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outFile = path.join(__dirname, '../main/db/schema.ts')

async function main() {
  // Create in-memory SQLite database
  const db = new Kysely<unknown>({
    dialect: new KyselySqliteDialect({ database: new Database(':memory:') }),
  })

  // Apply migrations
  await migrate(db)

  // Generate types
  await generate({
    db,
    dialect: new SqliteDialect(),
    outFile,
  })

  await db.destroy()
  console.log('Schema generated:', outFile)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
