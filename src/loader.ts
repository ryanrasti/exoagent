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

export type LoadedProvider = {
	name: string
	shortName: string
	uiInstance: object | null
	clients: string[]
	hasUI: boolean
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

	/** Scan, resolve ring0, DAG sort, dynamically import + instantiate. */
	async load(RealFunction: FunctionConstructor): Promise<{ loaded: LoadedProvider[], instances: Map<string, object> }> {
		const defs = this.scan()

		for (const def of defs) {
			if (def.parsed.ring0Source) {
				const fn = new RealFunction(`return (${def.parsed.ring0Source})()`) as () => Promise<unknown>
				def.parsed.ring0Result = await fn()
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

	/** Import a module via SES Compartment from its pre-built bundle. */
	async sesImport(bundlePath: string, name: string): Promise<{ default: (init: unknown) => object }> {
		let code: string
		try {
			code = readFileSync(bundlePath, 'utf-8')
		}
		catch {
			throw new Error(`missing pre-bundled index.js for provider "${name}" at ${bundlePath}`)
		}

		// Dynamically import @endo/module-source because we might be running
		// this before top-level await SES lockdown in some tests.
		const { ModuleSource } = await import('@endo/module-source')

		const compartment = new Compartment({
			resolveHook: spec => spec,
			importHook: async (spec) => {
				if (spec === 'root') {
					return { source: new ModuleSource(code) }
				}
				// Provide minimal bridge for external node/npm modules used by providers.
				// In a fully hardened setup, these would be stubs or deeply attenuated.
				if (['node:path', 'node:fs', 'zod', 'better-sqlite3'].includes(spec)) {
					const ns = Object.keys((globalThis as any).__ext[spec] || {})
					const exportsStr = ns.map(k => k === 'default' ? `export default globalThis.__ext['${spec}'].default;` : `export const ${k} = globalThis.__ext['${spec}']['${k}'];`).join('\\n')
					const source = new ModuleSource(exportsStr)
					return { source }
				}
				throw new Error(`Compartment missing external import: ${spec}`)
			},
			__options__: true, // Temporary flag needed for Endo module-source integration
		})

		// Expose bridged modules on globalThis for the bridge source to read.
		;(globalThis as any).__ext = (globalThis as any).__ext || {}
		for (const dep of ['node:path', 'node:fs', 'zod', 'better-sqlite3']) {
			if (!(globalThis as any).__ext[dep]) {
				;(globalThis as any).__ext[dep] = await import(dep)
			}
		}

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
				capBindings[dep] = attenuationFn(scoped)

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
			})
		}
		return { loaded, instances }
	}
}
