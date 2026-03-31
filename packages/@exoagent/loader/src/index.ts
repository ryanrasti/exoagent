/**
 * @exoagent/loader — two-phase dynamic worker loader.
 *
 * The control plane uses loadWorker() to spin up providers/exos
 * as dynamic workers with cap attenuation via manifest.
 */

/** Options for loading a dynamic worker. */
export interface LoadWorkerOptions {
	/** Unique name for caching (reuses if already loaded). Null = ephemeral. */
	name: string | null
	/** The manifest function source code (ES module, default export). */
	manifestCode: string
	/** The actual worker source code (ES module, default export). */
	workerCode: string
	/** Root caps to pass to the manifest for attenuation. */
	rootCaps: { [key: string]: unknown }
}

/**
 * Shim source — mainModule for every dynamic worker.
 *
 * Two-phase loading via RPC:
 * 1. Control plane calls init(rootCaps) on the shim entrypoint
 * 2. Shim runs manifest with rootCaps, stores attenuated caps
 * 3. Shim dynamic-imports worker.js
 * 4. On fetch, shim sets env.providers and delegates to worker
 *
 * rootCaps never touch env — they arrive via one-time RPC and
 * are consumed by the manifest function scope.
 */
// keep in sync with shim.js
const SHIM = [
	'import manifest from "./manifest.js"',
	'let handler = null',
	'let providers = null',
	'export default {',
	'  async init(rootCaps) {',
	'    providers = manifest(rootCaps)',
	'    const mod = await import("./worker.js")',
	'    const exported = mod.default',
	'    handler = typeof exported === "function" ? new exported() : exported',
	'  },',
	'  async fetch(request, env, ctx) {',
	'    if (!handler) return new Response("not initialized", { status: 503 })',
	'    env.providers = providers',
	'    return handler.fetch(request, env, ctx)',
	'  },',
	'}',
].join('\n')

/**
 * Load a provider/exo as a dynamic worker with cap attenuation.
 *
 * Uses WorkerLoader to spin up a worker with three modules:
 * - shim.js (mainModule) — generic two-phase loader
 * - manifest.js — the manifest function
 * - worker.js — the actual provider/exo code
 *
 * After loading, calls init(rootCaps) via RPC to run the manifest
 * and set up the worker. rootCaps never appear in env.
 */
export async function loadWorker(loader: WorkerLoader, options: LoadWorkerOptions) {
	const { name, manifestCode, workerCode, rootCaps } = options

	const code = {
		compatibilityDate: '2026-03-10',
		compatibilityFlags: ['nodejs_compat'],
		mainModule: 'shim.js',
		modules: {
			'shim.js': SHIM,
			'manifest.js': manifestCode,
			'worker.js': workerCode,
		},
		env: {},
		globalOutbound: null,
	}

	const worker = name
		? loader.get(name, () => code as any)
		: loader.load(code as any)

	const entrypoint = worker.getEntrypoint()
	await (entrypoint as any).init(rootCaps)

	return worker
}
