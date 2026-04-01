import type { ScopedConfig } from '../config'

/**
 * Matrix provider manifest.
 *
 * ring0: matrix-js-sdk client factory + fs (needs fetch, WebAssembly, IndexedDB).
 * config: for storing homeserver URL, access token, space ID.
 */
export default {
	'ring0': async () => {
		// @ts-expect-error — fake-indexeddb/auto types not resolved via package.json exports
		await import('fake-indexeddb/auto')

		// Silence Rust crypto tracing (DEBUG/INFO spam)
		const { Tracing, LoggerLevel } = await import('@matrix-org/matrix-sdk-crypto-wasm')
		const tracing = new Tracing(LoggerLevel.Error)
		tracing.turnOn()

		const sdk = await import('matrix-js-sdk')
		// Silence the global SDK logger (used by room.js, scheduler.js, event.js etc.)
		// The SDK uses loglevel: the root logger + child loggers (MatrixRTCSession etc.)
		// Setting the root level to SILENT prevents child loggers from inheriting DEBUG.
		const { logger } = await import('matrix-js-sdk/lib/logger')
		// @ts-expect-error — setLevel exists on the loglevel-backed logger
		logger.setLevel('silent')
		// Also silence any future child loggers by patching getChild
		const origGetChild = logger.getChild as (...args: unknown[]) => unknown
		logger.getChild = (namespace: string) => {
			const child = origGetChild.call(logger, namespace) as any
			child.setLevel('silent')
			return child
		}

		// Silent logger for the client instance (FetchHttpApi, sync, etc.)
		const noop = () => {}
		const silentLogger = { getChild: () => silentLogger, trace: noop, debug: noop, info: noop, warn: noop, error: noop, log: noop } as any

		const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
		const { resolve } = await import('node:path')

		return {
			createClient: (opts: any) => sdk.createClient({ ...opts, logger: silentLogger }),
			MemoryStore: sdk.MemoryStore,
			readFileSync,
			writeFileSync,
			mkdirSync,
			resolve,
		}
	},
	'@exoagent/providers/config': (config: ScopedConfig) => config,
}
