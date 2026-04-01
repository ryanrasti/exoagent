/**
 * Provider loader — reads manifests, DAG-sorts, instantiates providers.
 *
 * Each provider's index.ts must `export default` its factory function.
 *
 * Provider modules are loaded via SES Compartment (sesImport).
 * Manifests are parsed with acorn to extract key → value source map.
 */

import type * as acorn from 'acorn'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parse } from 'acorn'
import tsBlankSpace from 'ts-blank-space'
import { makeBoundEval } from './bound-eval'
import { exoEval } from './exoeval'
import { formatCodeMessage } from './exoeval/utils'

export type DaemonConfig = {
	dataDir: string
}

type ParsedManifest = {
	ring0Source: string | null
	ring0Result: unknown
	attenuations: { [dep: string]: string }
	deps: string[]
}

export type ProviderDef = {
	/** Fully qualified name, e.g., '@exoagent/providers/pi' */
	name: string
	/** Short name (directory name), e.g., 'pi' — used for routing, filesystem, RPC bindings */
	shortName: string
	dir: string
	bundlePath: string
	parsed: ParsedManifest
	hasUI: boolean
}

export type ModuleStatus = 'pending' | 'ready' | 'error'

export type LoadedProvider = {
	name: string
	shortName: string
	uiInstance: object | null
	clients: string[]
	hasUI: boolean
	status: ModuleStatus
	bootMs?: number
	error?: string
}

export type ScanDir = {
	/** Directory to scan for module subdirectories */
	src: string
	/** Directory where pre-built bundles live */
	dist: string
	/** Namespace prefix (e.g., '@exoagent/providers', './exos') */
	namespace: string
}

export class ProviderLoader {
	private readonly scanDirs: ScanDir[]
	private readonly config: DaemonConfig

	constructor(scanDirs: ScanDir[], config: DaemonConfig) {
		for (const { src } of scanDirs) {
			const stat = statSync(src, { throwIfNoEntry: false })
			if (!stat?.isDirectory()) {
				throw new Error(`module directory does not exist: ${src}`)
			}
		}
		this.scanDirs = scanDirs
		this.config = config
	}

	/**
	 * Scan, DAG sort, return pending modules immediately.
	 * Call boot() to start instantiating in the background.
	 */
	prepare(): { providers: { [shortName: string]: LoadedProvider }, sorted: ProviderDef[] } {
		const defs = this.scan()
		const sorted = this.dagSort(defs)

		const providers: { [shortName: string]: LoadedProvider } = {}
		for (const def of sorted) {
			providers[def.shortName] = {
				name: def.name,
				shortName: def.shortName,
				uiInstance: null,
				clients: [],
				hasUI: def.hasUI,
				status: 'pending',
			}
		}

		return { providers, sorted }
	}

	/**
	 * Instantiate modules one by one in DAG order, updating providers map in place.
	 * Failures are isolated — a failed module is marked 'error' but others continue.
	 */
	async boot(
		sorted: ProviderDef[],
		providers: { [shortName: string]: LoadedProvider },
		RealFunction: FunctionConstructor,
	): Promise<void> {
		const instances = new Map<string, object>()
		const clients = new Map<string, string[]>()

		for (const def of sorted) {
			clients.set(def.name, [])
		}

		for (const def of sorted) {
			const start = performance.now()
			const p = providers[def.shortName]

			try {
				// Resolve ring0 if needed
				if (def.parsed.ring0Source) {
					const fn = new RealFunction(`return (${def.parsed.ring0Source})()`) as () => Promise<unknown>
					def.parsed.ring0Result = harden(await fn())
				}

				// Check that all deps are ready
				const { deps, attenuations, ring0Result } = def.parsed
				for (const dep of deps) {
					const depShort = dep.split('/').at(-1)!
					if (providers[depShort]?.status === 'error') {
						throw new Error(`dependency "${dep}" failed to load`)
					}
				}

				const { default: createProvider } = await this.sesImport(def.bundlePath, def.name)
				if (typeof createProvider !== 'function') {
					throw new TypeError(`index.ts must default-export a factory function`)
				}

				// Build attenuated caps
				const capBindings: { [key: string]: unknown } = {}
				for (const dep of deps) {
					const depRoot = instances.get(dep) as { clientProvider?: (name: string) => unknown }
					if (!depRoot) {
						throw new Error(`"${dep}" is not loaded`)
					}
					if (typeof depRoot.clientProvider !== 'function') {
						throw new TypeError(`"${dep}" does not export a clientProvider`)
					}

					const scoped = depRoot.clientProvider(def.name)
					const fnSource = attenuations[dep]
					if (!fnSource) {
						throw new Error(`missing attenuation for dep "${dep}"`)
					}
					const attenuationFn = exoEval(fnSource)
					if (typeof attenuationFn !== 'function') {
						throw new TypeError(`attenuation for dep "${dep}" must be a function`)
					}

					const depShortName = dep.split('/').at(-1)!
					capBindings[depShortName] = attenuationFn(scoped)
					clients.get(dep)?.push(def.name)
				}

				const result = createProvider({
					exoEval: makeBoundEval(capBindings),
					ring0: ring0Result ?? null,
					config: this.config,
				})
				const instance = result instanceof Promise ? (await result ?? {}) : result
				instances.set(def.name, instance)

				const root = instance as { uiProvider?: (clients: string[]) => object }
				const myClients = clients.get(def.name) ?? []

				p.uiInstance = typeof root.uiProvider === 'function' ? root.uiProvider(myClients) : null
				p.clients = myClients
				p.status = 'ready'
				p.bootMs = Math.round(performance.now() - start)
				console.log(`  ✓ ${def.name} (${p.bootMs}ms)`)

				// Wire up pi's capEvalFactory as soon as pi loads
				// (must happen before exos boot, which are later in DAG order)
				if (def.name === '@exoagent/providers/pi') {
					const piInst = instance as {
						setCapEvalFactory?: (factory: (capNames: string[], client: string) => (code: string) => unknown) => void
					}
					if (piInst.setCapEvalFactory) {
						piInst.setCapEvalFactory((capNames: string[], client: string) => {
							const bindings: { [key: string]: unknown } = {}
							for (const name of capNames) {
								const fullName = `@exoagent/providers/${name}`
								const inst = instances.get(fullName) as { clientProvider?: (name: string) => unknown } | undefined
								if (inst?.clientProvider) {
									bindings[name] = inst.clientProvider(client)
								}
							}
							const boundEval = makeBoundEval(bindings)
							return (code: string) => boundEval(new RealFunction(`return ${code}`)() as any)
						})
					}
				}
			}
			catch (err) {
				p.status = 'error'
				p.error = err instanceof Error ? err.message : String(err)
				p.bootMs = Math.round(performance.now() - start)
				console.error(`  ✗ ${def.name}: ${p.error}`)
			}
		}
	}

	/** Convenience: scan + sort + instantiate all at once (for tests). */
	async load(RealFunction: FunctionConstructor): Promise<{ loaded: LoadedProvider[], instances: Map<string, object> }> {
		const defs = this.scan()

		for (const def of defs) {
			if (def.parsed.ring0Source) {
				const fn = new RealFunction(`return (${def.parsed.ring0Source})()`) as () => Promise<unknown>
				def.parsed.ring0Result = harden(await fn())
			}
		}

		const sorted = this.dagSort(defs)
		return this.instantiate(sorted)
	}

	// ── Scan ───────────────────────────────────────────────────────

	scan(): ProviderDef[] {
		const defs: ProviderDef[] = []
		const seen = new Map<string, string>()

		for (const { src, dist, namespace } of this.scanDirs) {
			for (const entry of readdirSync(src)) {
				const dir = resolve(src, entry)
				if (!statSync(dir).isDirectory()) { continue }

				const manifestPath = resolve(dir, 'manifest.ts')
				if (!statSync(manifestPath, { throwIfNoEntry: false })) {
					// Skip directories without a manifest (e.g., README-only dirs)
					continue
				}

				const fullName = `${namespace}/${entry}`
				if (seen.has(entry)) {
					throw new Error(`duplicate short name "${entry}" — used by both "${seen.get(entry)}" and "${fullName}"`)
				}
				seen.set(entry, fullName)

				const raw = readFileSync(manifestPath, 'utf-8')
				const relPath = relative(src, manifestPath)
				const entries = this.parseManifest(raw, relPath)

				const { ring0, ...attenuations } = entries

				defs.push({
					name: fullName,
					shortName: entry,
					dir,
					bundlePath: resolve(dist, entry, 'index.js'),
					parsed: {
						ring0Source: ring0 ?? null,
						ring0Result: undefined,
						attenuations,
						deps: Object.keys(attenuations),
					},
					hasUI: statSync(resolve(dir, 'ui.tsx'), { throwIfNoEntry: false }) !== undefined,
				})
			}
		}

		return defs
	}

	// ── Manifest parsing ───────────────────────────────────────────

	/** Strip TS, parse as module, find default export, return key → value source map. */
	parseManifest(raw: string, path: string): { [key: string]: string } {
		const js = tsBlankSpace(raw)

		let ast: acorn.Program
		try {
			ast = parse(js, { ecmaVersion: 2022, sourceType: 'module' })
		}
		catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			throw new Error(`failed to parse ${path}: ${msg}`)
		}

		const exportDefault = ast.body.find(
			(n): n is acorn.ExportDefaultDeclaration => n.type === 'ExportDefaultDeclaration',
		)
		if (!exportDefault) {
			throw new Error(`${path}: missing \`export default\``)
		}

		const decl = exportDefault.declaration
		if (decl.type !== 'ObjectExpression') {
			throw new Error(
				formatCodeMessage(js, decl.start, `${path}: default export must be an object expression, got ${decl.type}`),
			)
		}

		const entries: { [key: string]: string } = {}

		for (const rawProp of decl.properties) {
			if (rawProp.type !== 'Property') {
				throw new Error(
					formatCodeMessage(js, rawProp.start, `${path}: only plain properties allowed, got ${rawProp.type}`),
				)
			}
			const prop = rawProp as acorn.Property
			let key: string | null = null
			if (prop.key.type === 'Identifier') {
				key = prop.key.name
			}
			else if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') {
				key = prop.key.value
			}
			else {
				throw new Error(
					formatCodeMessage(js, prop.key.start, `${path}: property keys must be identifiers or string literals`),
				)
			}

			entries[key] = js.slice(prop.value.start, prop.value.end)
		}

		return entries
	}

	// ── SES import ─────────────────────────────────────────────────

	// Cached ModuleSource for shared deps (zod) — parsed once, reused across compartments
	private sharedModules: Map<string, object> | null = null

	/** Pre-parse shared deps. Called once on first sesImport. */
	private async warmSharedModules(): Promise<Map<string, object>> {
		if (this.sharedModules) { return this.sharedModules }
		const { ModuleSource } = await import('@endo/module-source')
		const zodSrc = readFileSync(resolve(import.meta.dirname, '..', 'dist/shared/zod.js'), 'utf-8')
		this.sharedModules = new Map([
			['zod', { source: new ModuleSource(zodSrc) }],
		])
		return this.sharedModules
	}

	/** Import a module via SES Compartment from its pre-built bundle. */
	async sesImport(bundlePath: string, name: string): Promise<{ default: (init: unknown) => object }> {
		let code: string
		try {
			code = readFileSync(bundlePath, 'utf-8')
		}
		catch {
			throw new Error(`missing pre-bundled index.js for provider "${name}" at ${bundlePath}`)
		}

		const shared = await this.warmSharedModules()
		const { ModuleSource } = await import('@endo/module-source')

		const compartment = new Compartment({
			globals: { console, process: { env: process.env, cwd: () => process.cwd() } },
			resolveHook: (spec: string) => spec,
			importHook: async (spec: string) => {
				if (spec === 'root') {
					return { source: new ModuleSource(code) }
				}
				const cached = shared.get(spec)
				if (cached) {
					return cached
				}
				throw new Error(`Compartment missing external import: ${spec}`)
			},
			__options__: true,
		})

		const { namespace } = await compartment.import('root')
		return namespace as { default: (init: unknown) => object }
	}

	// ── DAG sort ───────────────────────────────────────────────────

	dagSort(providers: ProviderDef[]): ProviderDef[] {
		const byName = new Map<string, ProviderDef>()
		for (const p of providers) {
			byName.set(p.name, p)
		}

		const sorted: ProviderDef[] = []
		const visited = new Set<string>()
		const visiting = new Set<string>()

		const visit = (name: string, path: string[]) => {
			if (visited.has(name)) { return }
			if (visiting.has(name)) {
				throw new Error(`dependency cycle: ${[...path, name].join(' → ')}`)
			}
			const def = byName.get(name)
			if (!def) {
				throw new Error(`unknown provider "${name}" (required by ${path.at(-1) ?? 'root'})`)
			}

			visiting.add(name)
			for (const dep of def.parsed.deps.toSorted()) {
				visit(dep, [...path, name])
			}
			visiting.delete(name)
			visited.add(name)
			sorted.push(def)
		}

		for (const name of [...byName.keys()].toSorted()) {
			visit(name, [])
		}
		return sorted
	}

	// ── Instantiation ──────────────────────────────────────────────

	async instantiate(sorted: ProviderDef[]): Promise<{ loaded: LoadedProvider[], instances: Map<string, object> }> {
		const instances = new Map<string, object>()
		const clients = new Map<string, string[]>()

		for (const def of sorted) {
			clients.set(def.name, [])
		}

		for (const def of sorted) {
			const { deps, attenuations, ring0Result } = def.parsed

			const { default: createProvider } = await this.sesImport(def.bundlePath, def.name)
			if (typeof createProvider !== 'function') {
				throw new TypeError(`provider "${def.name}" index.ts must default-export a factory function`)
			}

			// Build attenuated caps (empty for leaf providers)
			const capBindings: { [key: string]: unknown } = {}

			for (const dep of deps) {
				const depRoot = instances.get(dep) as { clientProvider?: (name: string) => unknown }
				if (!depRoot) {
					throw new Error(`"${def.name}" depends on "${dep}" which is not loaded`)
				}
				if (typeof depRoot.clientProvider !== 'function') {
					throw new TypeError(`"${dep}" does not export a clientProvider`)
				}

				const scoped = depRoot.clientProvider(def.name)

				const fnSource = attenuations[dep]
				if (!fnSource) {
					throw new Error(`"${def.name}": missing attenuation for dep "${dep}"`)
				}
				const attenuationFn = exoEval(fnSource)
				if (typeof attenuationFn !== 'function') {
					throw new TypeError(`attenuation for "${def.name}" dep "${dep}" must be a function`)
				}

				// Use short name (last segment) as the binding key — this is what user code destructures
				const depShortName = dep.split('/').at(-1)!
				capBindings[depShortName] = attenuationFn(scoped)

				clients.get(dep)?.push(def.name)
			}

			const result = createProvider({
				exoEval: makeBoundEval(capBindings),
				ring0: ring0Result ?? null,
				config: this.config,
			})
			// Await if factory returns a promise (e.g., exos with async init)
			instances.set(def.name, result instanceof Promise ? (await result ?? {}) : result)
		}

		const loaded: LoadedProvider[] = []
		for (const def of sorted) {
			const root = instances.get(def.name) as { uiProvider?: (clients: string[]) => object }
			const myClients = clients.get(def.name) ?? []

			loaded.push({
				name: def.name,
				shortName: def.shortName,
				uiInstance: typeof root.uiProvider === 'function' ? root.uiProvider(myClients) : null,
				clients: myClients,
				hasUI: def.hasUI,
				status: 'ready',
			})
		}
		return { loaded, instances }
	}
}
