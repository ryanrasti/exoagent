import type { ScopedConfig } from '../config'

/**
 * Matrix provider manifest.
 *
 * ring0: matrix-js-sdk client factory.
 * config: for storing homeserver URL, access token, space ID.
 *
 * E2EE is disabled. matrix-js-sdk's WASM crypto uses IndexedDB (browser-only)
 * polyfilled with fake-indexeddb (in-memory). Device keys are lost on restart,
 * so other clients see a new unverified device each time and won't share
 * Megolm session keys. The proper fix is @matrix-org/matrix-sdk-crypto-nodejs
 * (native SQLite-backed crypto) but its API is ~35 methods behind the WASM
 * variant that matrix-js-sdk expects. Use unencrypted rooms for now.
 */
export default {
	'ring0': async () => {
		const sdk = await import('matrix-js-sdk')
		const { logger } = await import('matrix-js-sdk/lib/logger')
		// @ts-expect-error — setLevel exists on the loglevel-backed logger
		logger.setLevel('silent')
		const origGetChild = logger.getChild as (...args: unknown[]) => unknown
		logger.getChild = (namespace: string) => {
			const child = origGetChild.call(logger, namespace) as any
			child.setLevel('silent')
			return child
		}

		const noop = () => {}
		const silentLogger = { getChild: () => silentLogger, trace: noop, debug: noop, info: noop, warn: noop, error: noop, log: noop } as any

		return {
			createClient: (opts: any) => sdk.createClient({ ...opts, logger: silentLogger }),
			MemoryStore: sdk.MemoryStore,
		}
	},
	'@exoagent/providers/config': (config: ScopedConfig) => config,
}
