/**
 * exoagentd — daemon entry point.
 *
 * 1. Imports ses, calls lockdown()
 * 2. Loads providers dynamically via manifest DAG resolution
 * 3. Starts HTTP server with subdomain routing
 */

import type { LoadedProvider } from './loader'
import { resolve } from 'node:path'
import { ProviderLoader } from './loader'
import { startServer } from './server'

async function main() {
	// Capture the real Function before SES lockdown so we can evaluate ring0 manifests
	// that might contain dynamic imports (which SES strictly rejects at parse time).
	const RealFunction = Function

	// SES: lock down the global environment
	await import('ses')
	lockdown({ errorTaming: 'unsafe', overrideTaming: 'severe', consoleTaming: 'unsafe' })

	const port = Number(process.env.PORT) || 3000
	const dataDir = process.env.EXOAGENT_DATA ?? resolve(process.cwd(), '.exoagent')
	const providerDir = resolve(import.meta.dirname, 'providers')

	console.log(`Starting exoagentd (dataDir: ${dataDir})`)

	const loader = new ProviderLoader(providerDir, { dataDir })
	const loaded = await loader.load(RealFunction)

	const providers: { [name: string]: LoadedProvider } = {}
	for (const p of loaded) {
		providers[p.name] = p
	}

	startServer(providers, { port, dev: process.env.NODE_ENV !== 'production' })
}

main().catch((err) => {
	console.error('Fatal daemon error:', err)
	process.exit(1)
})
