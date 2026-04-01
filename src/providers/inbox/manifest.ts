import type { ScopedSqlite } from '../sqlite'

/**
 * Inbox provider manifest — depends on sqlite for durable message storage.
 */
export default {
	'@exoagent/providers/sqlite': (sqlite: ScopedSqlite) => sqlite,
}
