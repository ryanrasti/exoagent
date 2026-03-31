/**
 * Two-phase dynamic worker loader.
 *
 * Loads providers/exos as dynamic workers with cap attenuation via manifest.
 * The shim runs the manifest with root caps (sent via RPC), then
 * dynamic-imports the actual worker code with only attenuated caps.
 */

/** Options for loading a dynamic worker. */
export interface LoadWorkerOptions {
	/** Unique name for caching (reuses if already loaded). */
	name: string
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
 * - Control plane calls init(rootCaps) via RPC after loading
 * - Shim static-imports manifest.js, runs with rootCaps
 * - Shim dynamic-imports worker.js, detects class vs object
 * - On fetch, sets env.providers to attenuated caps
 * - rootCaps never in env, consumed via RPC only
 */
const SHIM = `import manifest from "./manifest.js"
let handler = null
let providers = null
export default {
  async init(rootCaps) {
    if (providers) throw new Error("already initialized")
    providers = manifest(rootCaps)
    for (const k of Object.keys(rootCaps)) delete rootCaps[k]
    const mod = await import("./worker.js")
    const exported = mod.default
    handler = typeof exported === "function" ? new exported() : exported
  },
  async fetch(request, env, ctx) {
    if (!handler) return new Response("not initialized", { status: 503 })
    env.providers = providers
    return handler.fetch(request, env, ctx)
  },
}`

/**
 * Load a provider/exo as a dynamic worker with cap attenuation.
 *
 * Uses WorkerLoader to spin up a worker with three modules:
 * - shim.js (mainModule) — generic two-phase loader
 * - manifest.js — the manifest function
 * - worker.js — the actual provider/exo code
 *
 * After loading, calls init(rootCaps) via RPC to run the manifest.
 * rootCaps never appear in env.
 */
export async function loadWorker(loader: WorkerLoader, options: LoadWorkerOptions) {
	const { name, manifestCode, workerCode, rootCaps } = options

	const worker = loader.get(name, () => ({
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
	}) as any)

	const entrypoint = worker.getEntrypoint()
	await (entrypoint as any).init(rootCaps)

	return worker
}
