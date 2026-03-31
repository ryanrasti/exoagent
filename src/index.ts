/**
 * exoagent control plane worker.
 *
 * Discovers providers from EXOAGENT_PROVIDERS env var (set by exoagentd).
 * Loads each as a dynamic worker via the loader.
 * Routes HTTP: /<provider-name>/... → provider's fetch handler.
 */

import { loadWorker } from './loader'
import { FetchProvider } from '@exoagent/fetch'

interface ProviderDef {
	manifestCode: string
	workerCode: string
}

/** Track which providers have been initialized. */
const initialized = new Set<string>()

/** Root caps available to all providers via manifest. */
const rootCaps: { [key: string]: unknown } = {
	fetch: new FetchProvider(),
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/health') {
			return Response.json({ status: 'ok' })
		}

		// Parse provider definitions from env
		const providers: { [name: string]: ProviderDef } = JSON.parse(env.EXOAGENT_PROVIDERS || '{}')

		// Route /<provider>/... to provider's fetch
		const match = url.pathname.match(/^\/([^/]+)(.*)$/)
		if (match) {
			const [, name, rest] = match
			const def = providers[name]
			if (def) {
				if (!initialized.has(name)) {
					await loadWorker(env.LOADER, {
						name,
						manifestCode: def.manifestCode,
						workerCode: def.workerCode,
						rootCaps,
					})
					initialized.add(name)
				}
				const worker = env.LOADER.get(name, () => ({}) as any)
				const providerUrl = new URL(rest || '/', url.origin)
				return worker.getEntrypoint().fetch(
					new Request(providerUrl.toString(), request),
				)
			}
		}

		// TODO: dashboard at /
		return new Response('Not Found', { status: 404 })
	},
} satisfies ExportedHandler<Env>
