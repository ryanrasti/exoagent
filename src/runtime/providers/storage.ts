import { mkdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import z from 'zod'
import { tool } from '../../exoeval/tool'

const DB_FILE = 'storage.db'

export class StorageCap {
  private readonly root: string
  private readonly provider: string
  private readonly db: Database.Database

  private constructor(root: string, db: Database.Database, provider: string) {
    this.root = root
    this.db = db
    this.provider = provider
  }

  /**
   * Create a StorageCap backed by a SQLite DB in the given directory.
   * Initializes the directory and DB schema on first call.
   */
  static create(root: string, provider = 'default'): StorageCap {
    const resolvedRoot = resolve(root)
    mkdirSync(resolvedRoot, { recursive: true })
    const db = new Database(resolve(resolvedRoot, DB_FILE))
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        provider TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (provider, key)
      )
    `)
    return new StorageCap(resolvedRoot, db, provider)
  }

  @tool(z.string())
  async get(key: string): Promise<unknown> {
    const row = this.db.prepare('SELECT value FROM kv WHERE provider = ? AND key = ?').get(this.provider, key) as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }

  @tool(z.string(), z.any())
  async set(key: string, value: unknown): Promise<void> {
    this.db.prepare('INSERT OR REPLACE INTO kv (provider, key, value) VALUES (?, ?, ?)').run(this.provider, key, JSON.stringify(value))
  }

  @tool(z.string())
  async delete(key: string): Promise<void> {
    this.db.prepare('DELETE FROM kv WHERE provider = ? AND key = ?').run(this.provider, key)
  }

  close(): void {
    this.db.close()
  }

  @tool(z.string())
  async dir(name: string): Promise<string> {
    const resolved = resolve(this.root, name)
    if (resolved === this.root) {
      throw new Error('dir name cannot be empty or "."')
    }
    if (!resolved.startsWith(`${this.root}/`)) {
      throw new Error(`dir name escapes storage root: ${name}`)
    }
    if (name === DB_FILE) {
      throw new Error(`dir name "${DB_FILE}" is reserved`)
    }
    await mkdir(resolved, { recursive: true })
    return resolved
  }
}
