/**
 * exoagentd HTTP server.
 *
 * - Subdomain routing: <provider>.localhost:<port> for provider UI + RPC
 * - localhost:<port> serves dashboard
 * - Provider UIs served from a generic HTML template (no per-provider boilerplate)
 */

import type { LoadedProvider } from './loader'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { exoEval } from './exoeval'

/**
 * Generic HTML shell for provider UIs.
 * Vite injects the actual panel component at dev time via /src/ui/provider-mount.tsx
 */
const providerHTML = (providerName: string, isDev: boolean): string => {
	const script = isDev
		? `
		<script type="module">
			import RefreshRuntime from "http://localhost:5173/@react-refresh"
			RefreshRuntime.injectIntoGlobalHook(window)
			window.$RefreshReg$ = () => {}
			window.$RefreshSig$ = () => (type) => type
			window.__vite_plugin_react_preamble_installed__ = true
		</script>
		<script type="module" src="http://localhost:5173/provider-mount.tsx?provider=${providerName}"></script>`
		: `<script type="module" src="/assets/provider-mount.js"></script>`

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${providerName} — exoagent</title>
	<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
	<meta name="x-provider" content="${providerName}" />
	<style>body { margin: 0; background: #1a1a1a; color: #e0e0e0; font-family: system-ui, sans-serif; }</style>
</head>
<body>
	<div id="root"></div>
	${script}
</body>
</html>`
}

const dashboardHTML = (isDev: boolean): string => {
	const script = isDev
		? `
		<script type="module">
			import RefreshRuntime from "http://localhost:5173/@react-refresh"
			RefreshRuntime.injectIntoGlobalHook(window)
			window.$RefreshReg$ = () => {}
			window.$RefreshSig$ = () => (type) => type
			window.__vite_plugin_react_preamble_installed__ = true
		</script>
		<script type="module" src="http://localhost:5173/dashboard/Dashboard.tsx"></script>`
		: `<script type="module" src="/assets/dashboard.js"></script>`

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>exoagent</title>
	<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
	<style>body { margin: 0; background: #1a1a1a; color: #e0e0e0; font-family: system-ui, sans-serif; }</style>
</head>
<body>
	<div id="root"></div>
	${script}
</body>
</html>`
}

/**
 * Extract subdomain from Host header or request URL.
 * e.g. "github.localhost:3000" → "github"
 * e.g. "localhost:3000" → null
 */
const getSubdomain = (c: { req: { header: (name: string) => string | undefined, url: string } }): string | null => {
	// Try Host header first (real HTTP), fall back to URL (tests)
	let hostname = c.req.header('host')?.split(':')[0]
	if (!hostname) {
		try {
			hostname = new URL(c.req.url).hostname
		}
		catch {
			return null
		}
	}
	const match = hostname.match(/^([a-z0-9-]+)\.localhost$/)
	return match ? match[1] : null
}

export type ServerOptions = {
	port?: number
	dev?: boolean
}

/**
 * Create the exoagentd Hono app.
 */
export const createApp = (
	providers: { [name: string]: LoadedProvider },
	options: ServerOptions = {},
) => {
	const { dev = false } = options
	const app = new Hono()

	// Route based on Host header
	app.get('/assets/favicon.svg', (c) => {
		const svg = readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf-8')
		return c.html(svg, 200, { 'Content-Type': 'image/svg+xml' })
	})

	app.get('/assets/logo.svg', (c) => {
		const svg = readFileSync(resolve(process.cwd(), 'public/logo.svg'), 'utf-8')
		return c.html(svg, 200, { 'Content-Type': 'image/svg+xml' })
	})

	app.use('*', async (c, next) => {
		const subdomain = getSubdomain(c)

		if (subdomain) {
			const provider = providers[subdomain]
			if (!provider) {
				return c.text(`unknown provider: ${subdomain}`, 404)
			}

			// Provider subdomain routes
			const path = new URL(c.req.url).pathname

			// RPC endpoint
			if (c.req.method === 'POST' && path === '/rpc') {
				try {
					const code = await c.req.text()
					if (!code.trim()) {
						return c.json({ error: 'empty expression' }, 400)
					}
					if (!provider.uiInstance) {
						return c.json({ error: `provider "${subdomain}" does not export a uiProvider` }, 400)
					}
					const result = exoEval(code, { [subdomain]: provider.uiInstance })
					const resolved = result instanceof Promise ? await result : result
					return c.json(resolved ?? null)
				}
				catch (err) {
					const message = err instanceof Error ? err.message : String(err)
					return c.text(message, 500)
				}
			}

			// Provider UI
			if (c.req.method === 'GET' && (path === '/' || path === '/index.html')) {
				return c.html(providerHTML(subdomain, dev))
			}

			// Fall through for static assets
			return next()
		}

		// Dashboard (no subdomain)
		const path = new URL(c.req.url).pathname

		if (c.req.method === 'GET' && path === '/health') {
			return c.json({ status: 'ok' })
		}

		if (c.req.method === 'GET' && path === '/api/providers') {
			const list = []
			for (const [name, p] of Object.entries(providers)) {
				list.push({
					name,
					hasUI: p.hasUI,
					clients: p.clients,
				})
			}
			return c.json({ providers: list })
		}

		if (c.req.method === 'GET' && (path === '/' || path === '/index.html')) {
			return c.html(dashboardHTML(dev))
		}

		return next()
	})

	return app
}

/**
 * Start the server on the given port.
 */
export const startServer = (
	providers: { [name: string]: LoadedProvider },
	options: ServerOptions = {},
) => {
	const { port = 3000 } = options
	const app = createApp(providers, options)

	serve({ fetch: app.fetch, port }, (info) => {
		console.log(`exoagentd listening on http://localhost:${info.port}`)
		for (const [name, p] of Object.entries(providers)) {
			if (p.hasUI) {
				console.log(`  ${name}: http://${name}.localhost:${info.port}/`)
			}
		}
	})

	return app
}
