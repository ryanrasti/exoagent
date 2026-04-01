/**
 * exoagentd — daemon entry point.
 *
 * 1. Imports ses, calls lockdown()
 * 2. Loads providers dynamically via manifest DAG resolution
 * 3. Starts HTTP server with subdomain routing
 */

import type { LoadedProvider, ScanDir } from './loader'
import { statSync } from 'node:fs'
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
	const workDir = process.env.EXOAGENT_DIR ?? process.cwd()
	const dataDir = resolve(workDir, '.exoagent')
	const providerDir = resolve(import.meta.dirname, 'providers')
	const providerDistDir = resolve(import.meta.dirname, '..', 'dist', 'providers')

	console.log(`Starting exoagentd (workDir: ${workDir}, dataDir: ${dataDir})`)

	const scanDirs: ScanDir[] = [
		{ src: providerDir, dist: providerDistDir, namespace: '@exoagent/providers' },
	]

	// Add workspace directories if they exist
	const workProviders = resolve(workDir, 'src/providers')
	if (statSync(workProviders, { throwIfNoEntry: false })?.isDirectory()) {
		scanDirs.push({ src: workProviders, dist: resolve(workDir, 'dist/providers'), namespace: './providers' })
	}
	const workExos = resolve(workDir, 'src/exos')
	if (statSync(workExos, { throwIfNoEntry: false })?.isDirectory()) {
		scanDirs.push({ src: workExos, dist: resolve(workDir, 'dist/exos'), namespace: './exos' })
	}

	const loader = new ProviderLoader(scanDirs, { dataDir })
	const { loaded } = await loader.load(RealFunction)

	// Key by shortName for subdomain routing
	const providers: { [shortName: string]: LoadedProvider } = {}
	for (const p of loaded) {
		providers[p.shortName] = p
	}

	startServer(providers, { port, dev: process.env.NODE_ENV !== 'production' })
}

main().catch((err) => {
	console.error('Fatal daemon error:', err)
	process.exit(1)
})
