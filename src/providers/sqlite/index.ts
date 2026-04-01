/**
 * SQLite provider — ring0, wraps better-sqlite3.
 *
 * Ring0: receives the Database constructor.
 * .scoped(clientName) → gives each client its own DB file.
 */

import type { ProviderInit } from '../../provider'
import z from 'zod'
import { tool } from '../../exoeval/tool'

type Ring0Caps = {
	Database: DatabaseConstructor
	mkdirSync: (path: string, options?: { recursive: boolean }) => void
	resolve: (...paths: string[]) => string
}

export type DatabaseConstructor = new (
	filename: string,
	options?: object,
) => DatabaseInstance

export type DatabaseInstance = {
	pragma: (pragma: string) => unknown
	exec: (sql: string) => void
	prepare: (sql: string) => Statement
	close: () => void
}

type Statement = {
	run: (...params: unknown[]) => { changes: number, lastInsertRowid: number | bigint }
	get: (...params: unknown[]) => unknown
	all: (...params: unknown[]) => unknown[]
}

export default ({ ring0, config }: ProviderInit) => {
	const { Database, mkdirSync, resolve } = ring0 as Ring0Caps
	const root = resolve(config.dataDir, 'sqlite')
	const dbs = new Map<string, DatabaseInstance>()

	return {
		clientProvider(clientName: string): ScopedSqlite {
			let db = dbs.get(clientName)
			if (!db) {
				mkdirSync(root, { recursive: true })
				db = new Database(resolve(root, `${clientName}.db`))
				db.pragma('journal_mode = WAL')
				dbs.set(clientName, db)
			}
			return new ScopedSqlite(db)
		},

		close(): void {
			for (const db of dbs.values()) {
				db.close()
			}
			dbs.clear()
		},
	}
}

export class ScopedSqlite {
	private readonly db: DatabaseInstance

	constructor(db: DatabaseInstance) {
		this.db = db
	}

	@tool(z.string())
	exec(sql: string): { ok: true } {
		this.db.exec(sql)
		return { ok: true }
	}

	@tool(z.string(), z.array(z.unknown()).optional())
	run(sql: string, params?: unknown[]): { changes: number, lastInsertRowid: number } {
		const stmt = this.db.prepare(sql)
		const info = params ? stmt.run(...params) : stmt.run()
		return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }
	}

	@tool(z.string(), z.array(z.unknown()).optional())
	query(sql: string, params?: unknown[]): unknown[] {
		const stmt = this.db.prepare(sql)
		return params ? stmt.all(...params) : stmt.all()
	}

	@tool(z.string(), z.array(z.unknown()).optional())
	get(sql: string, params?: unknown[]): unknown {
		const stmt = this.db.prepare(sql)
		return (params ? stmt.get(...params) : stmt.get()) ?? null
	}
}
