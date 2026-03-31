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
 * Two-phase loading via RPC:
 * 1. Control plane calls init(rootCaps) on the shim entrypoint
 * 2. Shim runs manifest with rootCaps, stores attenuated caps
 * 3. If allowedDomains is set, patches global fetch with domain checker
 * 4. Shim dynamic-imports worker.js
 * 5. On fetch, shim sets env.providers and delegates to worker
 */
const SHIM = `import manifest from "./manifest.js"
let handler = null
let providers = null
export default {
  async init(rootCaps) {
    if (providers) throw new Error("already initialized")
    providers = manifest(rootCaps)
    for (const k of Object.keys(rootCaps)) delete rootCaps[k]
    if (providers.allowedDomains) {
      const allowed = new Set(providers.allowedDomains)
      const realFetch = globalThis.fetch
      globalThis.fetch = (input, init) => {
        const url = new URL(typeof input === "string" ? input : input.url)
        if (!allowed.has(url.hostname)) {
          throw new Error("Fetch blocked: " + url.hostname + " not in allowed domains")
        }
        return realFetch(input, init)
      }
    }
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
	}) as any)

	const entrypoint = worker.getEntrypoint()
	await (entrypoint as any).init(rootCaps)

	return worker
}
