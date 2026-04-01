import type { ScopedConfig } from '../config'
import type { FetchProviderImpl } from '../fetch'

/**
 * Linear provider manifest.
 *
 * config: for storing API key.
 * fetch: attenuated to api.linear.app only.
 */
export default {
	'@exoagent/providers/config': (config: ScopedConfig) => config,
	'@exoagent/providers/fetch': (fetch: FetchProviderImpl) => fetch.allow(['api.linear.app']),
}
