/** SQLite provider — ring0 for better-sqlite3 and fs/path access. */
import type { mkdirSync as MkdirSyncFn } from 'node:fs'
import type { resolve as ResolveFn } from 'node:path'

export default {
	ring0: async (): Promise<{ Database: new (filename: string, options?: object) => unknown, mkdirSync: typeof MkdirSyncFn, resolve: typeof ResolveFn }> => {
		const db = (await import('better-sqlite3')).default
		const fs = await import('node:fs')
		const path = await import('node:path')
		return { Database: db, mkdirSync: fs.mkdirSync, resolve: path.resolve }
	},
}
