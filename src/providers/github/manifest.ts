import type { ScopedConfig } from '../config'
/**
 * GitHub provider manifest.
 *
 * config: already client-scoped by DAG resolver, pass through.
 * fetch: already client-scoped (identity), attenuate to api.github.com only.
 */
import type { FetchProviderImpl } from '../fetch'

export default {
	'@exoagent/providers/config': (config: ScopedConfig) => config,
	'@exoagent/providers/fetch': (fetch: FetchProviderImpl) => fetch.allow(['api.github.com']),
}
