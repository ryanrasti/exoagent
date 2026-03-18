import Database from 'better-sqlite3'
import { chmodSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DB_FILE = 'secrets.db'

/**
 * Daemon-only secrets store. Never exposed to exos.
 * Each provider gets its own set of named secrets (e.g. API keys).
 */
export class Secrets {
  private readonly root: string
  private readonly db: Database.Database

  private constructor(root: string, db: Database.Database) {
    this.root = root
    this.db = db
  }

  /**
   * Create a Secrets store backed by a SQLite DB in the given directory.
   * Initializes the directory (mode 0700) and DB schema on first call.
   */
  static create(root: string): Secrets {
    const resolvedRoot = resolve(root)
    mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 })
    const dbPath = resolve(resolvedRoot, DB_FILE)
    const db = new Database(dbPath)
    chmodSync(dbPath, 0o600)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (provider, name)
      )
    `)
    return new Secrets(resolvedRoot, db)
  }

  get(provider: string, name: string): string | null {
    const row = this.db.prepare('SELECT value FROM secrets WHERE provider = ? AND name = ?').get(provider, name) as { value: string } | undefined
    return row?.value ?? null
  }

  set(provider: string, name: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO secrets (provider, name, value) VALUES (?, ?, ?)').run(provider, name, value)
  }

  delete(provider: string, name: string): void {
    this.db.prepare('DELETE FROM secrets WHERE provider = ? AND name = ?').run(provider, name)
  }

  close(): void {
    this.db.close()
  }
}
