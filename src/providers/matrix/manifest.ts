import type { ScopedConfig } from '../config'
import type { FetchProviderImpl } from '../fetch'

/**
 * Matrix provider manifest.
 *
 * config: for storing homeserver URL, access token, room ID.
 * fetch: attenuated to the homeserver domain (set at runtime via config).
 *
 * Note: fetch is NOT domain-attenuated here since the homeserver URL is dynamic.
 * The provider itself validates URLs before making requests.
 */
export default {
	'@exoagent/providers/config': (config: ScopedConfig) => config,
	'@exoagent/providers/fetch': (fetch: FetchProviderImpl) => fetch,
}
