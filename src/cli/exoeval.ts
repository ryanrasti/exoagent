#!/usr/bin/env tsx
/**
 * exoeval CLI — evaluate expressions against provider capabilities.
 *
 * Usage:
 *   exoeval --caps matrix,github '({ matrix }) => matrix.listRooms()'
 *   exoeval --caps matrix       # REPL mode (no expression)
 *
 * Boots only the requested providers + their transitive deps.
 * Uses the same loader/SES/manifest machinery as the daemon.
 */

import type { ScanDir } from '../loader'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { BoundEval } from '../bound-eval'
import { ProviderLoader } from '../loader'

const usage = () => {
	console.log(`Usage: exoeval --caps <cap1,cap2,...> [expression]`)
	console.log(`       exoeval --caps matrix,github '({ matrix }) => matrix.listRooms()'`)
	console.log(`       exoeval --caps matrix  # REPL mode`)
	process.exit(1)
}

const main = async () => {
	// Parse args
	const args = process.argv.slice(2)
	let capNames: string[] = []
	let expression: string | null = null

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--caps' && args[i + 1]) {
			capNames = args[i + 1].split(',').map(s => s.trim())
			i++
		}
		else if (args[i] === '--help' || args[i] === '-h') {
			usage()
		}
		else if (!args[i].startsWith('-')) {
			expression = args[i]
		}
	}

	if (capNames.length === 0) { usage() }

	// SES setup (same as daemon)
	const RealFunction = Function
	await import('ses')
	lockdown({ errorTaming: 'unsafe', overrideTaming: 'severe', consoleTaming: 'unsafe' })

	// Loader setup
	const workDir = process.env.EXOAGENT_DIR ?? process.cwd()
	const dataDir = resolve(workDir, '.exoagent')
	const providerDir = resolve(import.meta.dirname, '..', 'providers')
	const providerDistDir = resolve(import.meta.dirname, '..', '..', 'dist', 'providers')

	mkdirSync(dataDir, { recursive: true })

	const scanDirs: ScanDir[] = [
		{ src: providerDir, dist: providerDistDir, namespace: '@exoagent/providers' },
	]

	const loader = new ProviderLoader(scanDirs, { dataDir })

	// Scan all providers, then filter to only what we need
	const allDefs = loader.scan()
	const needed = new Set<string>()

	const addWithDeps = (name: string) => {
		if (needed.has(name)) { return }
		const def = allDefs.find(d => d.shortName === name || d.name === name)
		if (!def) { throw new Error(`unknown provider: ${name}`) }
		needed.add(def.name)
		for (const dep of def.parsed.deps) {
			const depShort = dep.split('/').at(-1)!
			addWithDeps(depShort)
		}
	}

	for (const cap of capNames) { addWithDeps(cap) }

	// Filter and sort only needed providers
	const filteredDefs = allDefs.filter(d => needed.has(d.name))
	const sorted = loader.dagSort(filteredDefs)

	// Resolve ring0 for each
	for (const def of sorted) {
		if (def.parsed.ring0Source) {
			const fn = new RealFunction(`return (${def.parsed.ring0Source})()`) as () => Promise<unknown>
			def.parsed.ring0Result = harden(await fn())
		}
	}

	// Boot providers
	console.error(`Booting ${sorted.map(d => d.shortName).join(', ')}...`)
	const { instances } = await loader.instantiate(sorted)

	// Build BoundEval with requested caps
	const bindings: { [key: string]: unknown } = {}
	for (const name of capNames) {
		const fullName = `@exoagent/providers/${name}`
		const inst = instances.get(fullName) as { clientProvider?: (n: string) => unknown } | undefined
		if (inst?.clientProvider) {
			bindings[name] = inst.clientProvider('cli')
		}
		else if (inst) {
			bindings[name] = inst
		}
		else {
			console.error(`Warning: provider "${name}" loaded but has no clientProvider`)
		}
	}

	const boundEval = new BoundEval(bindings)

	const evaluate = async (code: string) => {
		try {
			const fn = new RealFunction(`return ${code}`)() as (...args: unknown[]) => unknown
			const result = boundEval.run(fn as any)
			const resolved = result instanceof Promise ? await result : result
			console.log(typeof resolved === 'string' ? resolved : JSON.stringify(resolved, null, 2))
		}
		catch (err) {
			console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
		}
	}

	if (expression) {
		// One-shot mode
		await evaluate(expression)
		process.exit(0)
	}

	// REPL mode
	console.error(`Caps: ${capNames.join(', ')}`)
	console.error(`Type expressions like: ({ matrix }) => matrix.listRooms()`)
	console.error(`Ctrl+D to exit\n`)

	const rl = createInterface({ input: process.stdin, output: process.stderr, prompt: 'exoeval> ' })
	rl.prompt()

	for await (const line of rl) {
		const trimmed = line.trim()
		if (!trimmed) { rl.prompt(); continue }
		await evaluate(trimmed)
		rl.prompt()
	}
}

main().catch((err) => {
	console.error('Fatal:', err)
	process.exit(1)
})
