/**
 * exoagent control plane worker.
 *
 * Manages providers and exos as dynamic workers via WorkerLoader.
 * Routes HTTP to provider UIs by name.
 */

import { loadWorker } from './loader'

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/health') {
			return Response.json({ status: 'ok' })
		}

		// TODO: dashboard at /
		// TODO: route /<provider-name>/... to provider's fetch()

		return new Response('Not Found', { status: 404 })
	},
} satisfies ExportedHandler<Env>
