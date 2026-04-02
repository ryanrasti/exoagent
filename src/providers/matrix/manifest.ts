import type { ScopedConfig } from '../config'

/**
 * Matrix provider manifest.
 *
 * ring0: matrix-js-sdk client factory + fs + crypto store persistence.
 * config: for storing homeserver URL, access token, space ID.
 */
export default {
	'ring0': async () => {
		// @ts-expect-error — fake-indexeddb/auto types not resolved via package.json exports
		await import('fake-indexeddb/auto')
		const { indexedDB } = await import('fake-indexeddb')

		// Silence Rust crypto tracing (DEBUG/INFO spam)
		const { Tracing, LoggerLevel } = await import('@matrix-org/matrix-sdk-crypto-wasm')
		const tracing = new Tracing(LoggerLevel.Error)
		tracing.turnOn()

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

		const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
		const { resolve } = await import('node:path')

		// Dump all fake-indexeddb databases to JSON (readonly tx = consistent snapshot)
		const dumpIDB = async (): Promise<string> => {
			const dbs = await indexedDB.databases()
			const dumps: any[] = []
			for (const { name, version } of dbs) {
				if (!name || !version) { continue }
				const db: IDBDatabase = await new Promise((r, j) => {
					const req = indexedDB.open(name, version)
					req.onsuccess = () => r(req.result)
					req.onerror = () => j(req.error)
				})
				const storeNames = Array.from(db.objectStoreNames)
				const dump: any = { name, version, storeNames, stores: {}, storeConfigs: {} }
				if (storeNames.length > 0) {
					const tx = db.transaction(storeNames, 'readonly')
					for (const sn of storeNames) {
						const store = tx.objectStore(sn)
						// Capture store config (keyPath, autoIncrement, indexes)
						const indexes: any[] = []
						for (const idxName of Array.from(store.indexNames)) {
							const idx = store.index(idxName)
							indexes.push({ name: idx.name, keyPath: idx.keyPath, unique: idx.unique, multiEntry: idx.multiEntry })
						}
						dump.storeConfigs[sn] = { keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes }
						const records: any[] = []
						await new Promise<void>((r) => {
							const cur = store.openCursor()
							cur.onsuccess = () => {
								const c = cur.result
								if (c) { records.push({ key: c.key, value: c.value }); c.continue() }
								else { r() }
							}
						})
						dump.stores[sn] = records
					}
				}
				db.close()
				dumps.push(dump)
			}
			return JSON.stringify(dumps)
		}

		// Restore fake-indexeddb state from JSON dump
		// Restore: open DB at version 1 to trigger onupgradeneeded and create
		// all stores. The WASM module will later open at its expected version
		// and run migrations, but the data will already be there.
		const restoreIDB = async (json: string): Promise<void> => {
			for (const dump of JSON.parse(json)) {
				const db: IDBDatabase = await new Promise((r, j) => {
					const req = indexedDB.open(dump.name, dump.version)
					req.onupgradeneeded = () => {
						const db = req.result
						for (const sn of dump.storeNames) {
							if (db.objectStoreNames.contains(sn)) { continue }
							const cfg = dump.storeConfigs?.[sn] ?? {}
							const opts: IDBObjectStoreParameters = {}
							if (cfg.keyPath != null) { opts.keyPath = cfg.keyPath }
							if (cfg.autoIncrement) { opts.autoIncrement = true }
							const store = db.createObjectStore(sn, opts)
							for (const idx of cfg.indexes ?? []) {
								store.createIndex(idx.name, idx.keyPath, { unique: idx.unique, multiEntry: idx.multiEntry })
							}
						}
					}
					req.onsuccess = () => r(req.result)
					req.onerror = () => j(req.error)
				})
				const storeNames = Object.keys(dump.stores).filter(s => db.objectStoreNames.contains(s))
				if (storeNames.length > 0) {
					const tx = db.transaction(storeNames, 'readwrite')
					for (const sn of storeNames) {
						for (const { key, value } of dump.stores[sn]) { tx.objectStore(sn).put(value, key) }
					}
					await new Promise<void>((r, j) => { tx.oncomplete = () => r(); tx.onerror = () => j(tx.error) })
				}
				db.close()
			}
		}

		return {
			createClient: (opts: any) => sdk.createClient({ ...opts, logger: silentLogger }),
			MemoryStore: sdk.MemoryStore,
			readFileSync,
			writeFileSync,
			mkdirSync,
			resolve,
			restoreCryptoStore: async (path: string) => {
				try { await restoreIDB(readFileSync(path, 'utf-8') as string) }
				catch { /* no saved state */ }
			},
			saveCryptoStore: async (path: string) => {
				try { writeFileSync(path, await dumpIDB()) }
				catch { /* best effort */ }
			},
		}
	},
	'@exoagent/providers/config': (config: ScopedConfig) => config,
}
