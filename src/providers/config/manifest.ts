/**
 * Config provider manifest — depends on sqlite.
 * Attenuation is identity (sqlite is already client-scoped by the DAG resolver).
 */
import type { ScopedSqlite } from '../sqlite'

export default {
	sqlite: (sqlite: ScopedSqlite) => sqlite,
}
