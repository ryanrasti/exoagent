/**
 * exoagent control plane worker.
 *
 * Manages providers and exos as dynamic workers via WorkerLoader.
 */

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url)

		switch (url.pathname) {
			case '/health':
				return Response.json({ status: 'ok' })
			default:
				return new Response('Not Found', { status: 404 })
		}
	},
} satisfies ExportedHandler<Env>
