/**
 * exoagent control plane worker.
 *
 * Manages providers and exos as dynamic workers via WorkerLoader.
 * Routes HTTP to provider UIs by name.
 */

import { loadWorker } from './loader'

/** Provider definitions — name → manifest + worker code + root caps. */
interface ProviderDef {
	manifestCode: string
	workerCode: string
	rootCaps: { [key: string]: unknown }
}

/** Track which providers have been initialized (init() called). */
const initialized = new Set<string>()

/** Built-in echo provider — for testing the loader. */
const PROVIDERS: { [name: string]: ProviderDef } = {
	echo: {
		manifestCode: `export default function(rootCaps) {
	return { prefix: rootCaps.prefix }
}`,
		workerCode: `export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		return new Response(env.providers.prefix + ': ' + url.pathname)
	},
}`,
		rootCaps: { prefix: 'echo' },
	},
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/health') {
			return Response.json({ status: 'ok' })
		}

		// Route /<provider>/... to provider's fetch
		const match = url.pathname.match(/^\/([^/]+)(.*)$/)
		if (match) {
			const [, name, rest] = match
			const def = PROVIDERS[name]
			if (def) {
				// loadWorker calls get() which reuses cached workers by name.
				// Only calls init() on first load.
				if (!initialized.has(name)) {
					await loadWorker(env.LOADER, { name, ...def })
					initialized.add(name)
				}
				// Get a fresh stub for this request context
				const worker = env.LOADER.get(name, () => ({}) as any)
				const providerUrl = new URL(rest || '/', url.origin)
				return worker.getEntrypoint().fetch(providerUrl.toString())
			}
		}

		return new Response('Not Found', { status: 404 })
	},
} satisfies ExportedHandler<Env>
