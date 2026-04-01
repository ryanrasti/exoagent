import type { ScopedConfig } from '../config'
/**
 * GitHub provider manifest.
 *
 * config: already client-scoped by DAG resolver, pass through.
 * fetch: already client-scoped (identity), attenuate to api.github.com only.
 */
import type { FetchProviderImpl } from '../fetch'

export default {
	config: (config: ScopedConfig) => config,
	fetch: (fetch: FetchProviderImpl) => fetch.allow(['api.github.com']),
}
