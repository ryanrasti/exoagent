/** SQLite provider — ring0 for better-sqlite3. */
export default {
	ring0: async () => (await import('better-sqlite3')).default,
}
