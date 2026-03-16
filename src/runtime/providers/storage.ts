import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import z from 'zod'
import { tool } from '../../exoeval/tool'

const DB_FILE = 'storage.db'

export class StorageCap {
  private readonly root: string
  private readonly provider: string
  private db: Database.Database | null = null

  constructor(root: string, provider = 'default') {
    this.root = resolve(root)
    this.provider = provider
  }

  private ensure(): Database.Database {
    if (this.db) return this.db
    mkdirSync(this.root, { recursive: true })
    this.db = new Database(resolve(this.root, DB_FILE))
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        provider TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (provider, key)
      )
    `)
    return this.db
  }

  @tool(z.string())
  async get(key: string): Promise<unknown> {
    const db = this.ensure()
    const row = db.prepare('SELECT value FROM kv WHERE provider = ? AND key = ?').get(this.provider, key) as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }

  @tool(z.string(), z.any())
  async set(key: string, value: unknown): Promise<void> {
    const db = this.ensure()
    db.prepare('INSERT OR REPLACE INTO kv (provider, key, value) VALUES (?, ?, ?)').run(this.provider, key, JSON.stringify(value))
  }

  @tool(z.string())
  async delete(key: string): Promise<void> {
    const db = this.ensure()
    db.prepare('DELETE FROM kv WHERE provider = ? AND key = ?').run(this.provider, key)
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  @tool(z.string())
  async dir(name: string): Promise<string> {
    const resolved = resolve(this.root, name)
    if (!resolved.startsWith(`${this.root}/`) && resolved !== this.root) {
      throw new Error(`dir name escapes storage root: ${name}`)
    }
    if (name === DB_FILE) {
      throw new Error(`dir name "${DB_FILE}" is reserved`)
    }
    await mkdir(resolved, { recursive: true })
    return resolved
  }
}
