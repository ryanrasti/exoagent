/**
 * exoagentd HTTP server.
 *
 * Single Hono server that:
 * - Routes POST /api/<provider> for exoeval RPC
 * - GET /api/providers to list providers
 * - GET /health for health checks
 * - Subdomain routing: <provider>.localhost:<port> serves provider UI
 * - localhost:<port> serves dashboard
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { exoEval } from './exoeval'

export interface ProviderRegistration {
	/** The provider instance with @tool() methods */
	instance: object
}

/**
 * Create the exoagentd Hono app.
 */
export function createApp(providers: { [name: string]: ProviderRegistration }) {
	const app = new Hono()

	// Health check
	app.get('/health', (c) => c.json({ status: 'ok' }))

	// List providers
	app.get('/api/providers', (c) => c.json({ providers: Object.keys(providers) }))

	// exoeval RPC endpoint: POST /api/<provider>
	app.post('/api/:provider', async (c) => {
		const name = c.req.param('provider')
		const registration = providers[name]
		if (!registration) {
			return c.json({ error: `unknown provider: ${name}` }, 404)
		}

		try {
			const code = await c.req.text()
			if (!code.trim()) {
				return c.json({ error: 'empty expression' }, 400)
			}

			const result = exoEval(code, { [name]: registration.instance })
			const resolved = result instanceof Promise ? await result : result
			return c.json(resolved ?? null)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return c.text(message, 500)
		}
	})

	return app
}

/**
 * Start the server on the given port.
 */
export function startServer(
	providers: { [name: string]: ProviderRegistration },
	options: { port?: number; uiDir?: string } = {},
) {
	const { port = 3000, uiDir } = options
	const app = createApp(providers)

	serve({ fetch: app.fetch, port }, (info) => {
		console.log(`exoagentd listening on http://localhost:${info.port}`)
		for (const name of Object.keys(providers)) {
			console.log(`  ${name}: http://${name}.localhost:${info.port}/`)
		}
	})

	return app
}
