import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DB_FILE = 'secrets.db'

/**
 * Daemon-only secrets store. Never exposed to exos.
 * Each provider gets its own set of named secrets (e.g. API keys).
 */
export class Secrets {
  private readonly root: string
  private db: Database.Database | null = null

  constructor(root: string) {
    this.root = resolve(root)
  }

  private ensure(): Database.Database {
    if (this.db) return this.db
    mkdirSync(this.root, { recursive: true })
    this.db = new Database(resolve(this.root, DB_FILE))
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (provider, name)
      )
    `)
    return this.db
  }

  get(provider: string, name: string): string | null {
    const db = this.ensure()
    const row = db.prepare('SELECT value FROM secrets WHERE provider = ? AND name = ?').get(provider, name) as { value: string } | undefined
    return row?.value ?? null
  }

  set(provider: string, name: string, value: string): void {
    const db = this.ensure()
    db.prepare('INSERT OR REPLACE INTO secrets (provider, name, value) VALUES (?, ?, ?)').run(provider, name, value)
  }

  delete(provider: string, name: string): void {
    const db = this.ensure()
    db.prepare('DELETE FROM secrets WHERE provider = ? AND name = ?').run(provider, name)
  }

  close(): void {
    this.db?.close()
    this.db = null
  }
}
