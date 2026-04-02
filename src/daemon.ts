/**
 * exoagentd — daemon entry point.
 *
 * ExoAgent class handles the full lifecycle:
 *   1. SES lockdown
 *   2. Scan manifests, DAG sort modules
 *   3. Start HTTP server
 *   4. Boot modules
 *   5. Stop server
 */

import type { Server } from 'node:http'
import type { LoadedProvider, ScanDir } from './loader'
import { mkdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { ProviderLoader } from './loader'
import { startServer } from './server'

export type ExoAgentOptions = {
	port?: number
	workDir?: string
	dev?: boolean
}

export class ExoAgent {
	private server: Server | null = null
	private providers: { [shortName: string]: LoadedProvider } = {}
	private _port = 0

	get port(): number { return this._port }

	async start(options: ExoAgentOptions = {}): Promise<void> {
		const bootStart = performance.now()

		// Capture before SES lockdown — need the real Function for ring0 eval
		const RealFunction = Function

		await import('ses')
		lockdown({ errorTaming: 'unsafe', overrideTaming: 'severe', consoleTaming: 'unsafe' })

		const port = options.port ?? (Number(process.env.PORT) || 3000)
		const workDir = options.workDir ?? process.env.EXOAGENT_DIR ?? process.cwd()
		const dev = options.dev ?? process.env.NODE_ENV !== 'production'
		const dataDir = resolve(workDir, '.exoagent')
		const providerDir = resolve(import.meta.dirname, 'providers')
		const providerDistDir = resolve(import.meta.dirname, '..', 'dist', 'providers')

		mkdirSync(dataDir, { recursive: true })

		const scanDirs: ScanDir[] = [
			{ src: providerDir, dist: providerDistDir, namespace: '@exoagent/providers' },
		]

		const workProviders = resolve(workDir, 'src/providers')
		if (workProviders !== providerDir && statSync(workProviders, { throwIfNoEntry: false })?.isDirectory()) {
			scanDirs.push({ src: workProviders, dist: resolve(workDir, 'dist/providers'), namespace: './providers' })
		}
		const workExos = resolve(workDir, 'src/exos')
		if (statSync(workExos, { throwIfNoEntry: false })?.isDirectory()) {
			scanDirs.push({ src: workExos, dist: resolve(workDir, 'dist/exos'), namespace: './exos' })
		}

		const loader = new ProviderLoader(scanDirs, { dataDir })
		const { providers, sorted } = loader.prepare()
		this.providers = providers

		const serverBootMs = Math.round(performance.now() - bootStart)
		this.server = startServer(providers, { port, dev, bootMs: serverBootMs })
		const addr = this.server.address()
		this._port = typeof addr === 'object' && addr ? addr.port : port

		console.log(`Booting ${sorted.length} modules...`)
		await loader.boot(sorted, providers, RealFunction)
		const totalBootMs = Math.round(performance.now() - bootStart)
		console.log(`All modules booted (${totalBootMs}ms total)`)
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => resolve())
			}
			else {
				resolve()
			}
		})
	}

	getProviders(): { [shortName: string]: LoadedProvider } {
		return this.providers
	}
}

// CLI entry point
if (process.argv[1]?.endsWith('daemon.ts') || process.argv[1]?.endsWith('daemon.js')) {
	// Parse CLI args
	let port: number | undefined
	let portFd: number | undefined
	for (let i = 2; i < process.argv.length; i++) {
		if (process.argv[i] === '--port' && process.argv[i + 1]) { port = Number(process.argv[++i]) }
		if (process.argv[i] === '--portfd' && process.argv[i + 1]) { portFd = Number(process.argv[++i]) }
	}

	const exo = new ExoAgent()
	exo.start({ port }).then(() => {
		if (portFd !== undefined) {
			process.stdout.write(`EXOAGENT_PORT=${exo.port}\n`)
		}
	}).catch((err) => {
		console.error('Fatal daemon error:', err)
		process.exit(1)
	})
}
