/**
 * exoagentd — daemon entry point.
 *
 * 1. Imports ses, calls lockdown()
 * 2. Scans manifests, DAG sorts modules
 * 3. Starts HTTP server immediately (all modules pending)
 * 4. Boots modules one by one in the background
 */

import type { ScanDir } from './loader'
import { mkdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { ProviderLoader } from './loader'
import { startServer } from './server'

const main = async () => {
	const bootStart = performance.now()

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

	mkdirSync(dataDir, { recursive: true })

	const scanDirs: ScanDir[] = [
		{ src: providerDir, dist: providerDistDir, namespace: '@exoagent/providers' },
	]

	// Add workspace directories if they exist (and aren't the same as built-in)
	const workProviders = resolve(workDir, 'src/providers')
	if (workProviders !== providerDir && statSync(workProviders, { throwIfNoEntry: false })?.isDirectory()) {
		scanDirs.push({ src: workProviders, dist: resolve(workDir, 'dist/providers'), namespace: './providers' })
	}
	const workExos = resolve(workDir, 'src/exos')
	if (statSync(workExos, { throwIfNoEntry: false })?.isDirectory()) {
		scanDirs.push({ src: workExos, dist: resolve(workDir, 'dist/exos'), namespace: './exos' })
	}

	// Phase 1: Scan + sort (fast — just file reads)
	const loader = new ProviderLoader(scanDirs, { dataDir })
	const { providers, sorted } = loader.prepare()

	// Phase 2: Start server immediately with all modules in 'pending' state
	const serverBootMs = Math.round(performance.now() - bootStart)
	startServer(providers, { port, dev: process.env.NODE_ENV !== 'production', bootMs: serverBootMs })

	// Phase 3: Boot modules in the background
	console.log(`Booting ${sorted.length} modules...`)
	await loader.boot(sorted, providers, RealFunction)
	const totalBootMs = Math.round(performance.now() - bootStart)
	console.log(`All modules booted (${totalBootMs}ms total)`)
}

main().catch((err) => {
	console.error('Fatal daemon error:', err)
	process.exit(1)
})
