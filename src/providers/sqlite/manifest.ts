/** SQLite provider — ring0 for better-sqlite3 and fs/path access. */
export default {
	ring0: async () => {
		const db = (await import('better-sqlite3')).default
		const fs = await import('node:fs')
		const path = await import('node:path')
		return { Database: db, mkdirSync: fs.mkdirSync, resolve: path.resolve }
	},
}
