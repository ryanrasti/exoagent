/**
 * Pi provider — ring0 for pi SDK imports and native node modules.
 *
 * Also depends on config for storing API keys.
 */
import type { ScopedConfig } from '../config'

export default {
	ring0: async () => {
		const piSdk = await import('@mariozechner/pi-coding-agent')
		const path = await import('node:path')
		const os = await import('node:os')
		return { piSdk, resolve: path.resolve, join: path.join, homedir: os.homedir }
	},
	config: (config: ScopedConfig) => config,
}
