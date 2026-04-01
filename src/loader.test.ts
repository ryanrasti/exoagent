import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ProviderLoader } from './loader'
import 'ses'

if (typeof Compartment === 'undefined') {
	lockdown({ errorTaming: 'unsafe', overrideTaming: 'severe', consoleTaming: 'unsafe' })
}

const testDir = join(tmpdir(), `exoagent-loader-test-${process.pid}`)
const daemonConfig = { dataDir: testDir }

const makeProvider = (name: string, manifest: string, indexTs?: string) => {
	const dir = resolve(testDir, name)
	mkdirSync(dir, { recursive: true })
	writeFileSync(resolve(dir, 'manifest.ts'), manifest)
	if (indexTs) {
		writeFileSync(resolve(dir, 'index.ts'), indexTs)
		// For tests, mock the build output step
		const distDir = resolve(process.cwd(), 'dist/providers', name)
		mkdirSync(distDir, { recursive: true })
		writeFileSync(resolve(distDir, 'index.js'), indexTs) // In tests, the raw code is already plain JS
	}
}

describe('ProviderLoader.scan', () => {
	beforeEach(() => mkdirSync(testDir, { recursive: true }))
	afterEach(() => rmSync(testDir, { recursive: true, force: true }))

	it('scans directories with manifest.ts', () => {
		makeProvider('alpha', 'export default {}')
		makeProvider('beta', 'export default {}')

		const loader = new ProviderLoader(testDir, daemonConfig)
		const defs = loader.scan()
		expect(defs.map(d => d.name).toSorted()).toEqual(['alpha', 'beta'])
	})

	it('throws if provider dir missing manifest.ts', () => {
		mkdirSync(resolve(testDir, 'no-manifest'), { recursive: true })

		const loader = new ProviderLoader(testDir, daemonConfig)
		expect(() => loader.scan()).toThrow(/missing manifest\.ts/)
	})

	it('extracts deps from manifest', () => {
		makeProvider(
			'child',
			`
			import type { Foo } from '../parent'
			export default {
				parent: (p: Foo) => p,
			}
			`,
		)

		const loader = new ProviderLoader(testDir, daemonConfig)
		const defs = loader.scan()
		expect(defs[0].parsed.deps).toEqual(['parent'])
	})

	it('extracts ring0 source', () => {
		makeProvider(
			'native',
			`export default {
				ring0: async () => 42,
			}`,
		)

		const loader = new ProviderLoader(testDir, daemonConfig)
		const defs = loader.scan()
		expect(defs[0].parsed.ring0Source).toContain('async')
		expect(defs[0].parsed.ring0Source).toContain('42')
		expect(defs[0].parsed.deps).toEqual([])
	})

	it('splits ring0 from deps', () => {
		makeProvider(
			'mixed',
			`export default {
				ring0: async () => 99,
				other: (x: unknown) => x,
			}`,
		)

		const loader = new ProviderLoader(testDir, daemonConfig)
		const defs = loader.scan()
		expect(defs[0].parsed.ring0Source).toContain('99')
		expect(defs[0].parsed.deps).toEqual(['other'])
	})
})

describe('ProviderLoader.dagSort', () => {
	const def = (name: string, deps: string[]) => {
		const attenuations: { [k: string]: string } = {}
		for (const d of deps) {
			attenuations[d] = `(${d}) => ${d}`
		}
		return {
			name,
			dir: '',
			parsed: { ring0Source: null, ring0Result: undefined, attenuations, deps },
			hasUI: false,
		}
	}

	it('sorts leaves first', () => {
		const loader = new ProviderLoader(tmpdir(), daemonConfig)
		const sorted = loader.dagSort([def('b', ['a']), def('a', [])])
		expect(sorted.map(d => d.name)).toEqual(['a', 'b'])
	})

	it('alphabetical tie-breaking', () => {
		const loader = new ProviderLoader(tmpdir(), daemonConfig)
		const sorted = loader.dagSort([def('c', []), def('a', []), def('b', [])])
		expect(sorted.map(d => d.name)).toEqual(['a', 'b', 'c'])
	})

	it('diamond dependency', () => {
		const loader = new ProviderLoader(tmpdir(), daemonConfig)
		const sorted = loader.dagSort([
			def('d', ['b', 'c']),
			def('b', ['a']),
			def('c', ['a']),
			def('a', []),
		])
		expect(sorted.map(d => d.name)).toEqual(['a', 'b', 'c', 'd'])
	})

	it('throws on cycle', () => {
		const loader = new ProviderLoader(tmpdir(), daemonConfig)
		expect(() => loader.dagSort([def('a', ['b']), def('b', ['a'])])).toThrow(/cycle/)
	})

	it('throws on unknown dep', () => {
		const loader = new ProviderLoader(tmpdir(), daemonConfig)
		expect(() => loader.dagSort([def('a', ['missing'])])).toThrow(/unknown provider/)
	})
})

describe('ProviderLoader.load', () => {
	beforeEach(() => mkdirSync(testDir, { recursive: true }))
	afterEach(() => rmSync(testDir, { recursive: true, force: true }))

	it('loads ring0 provider via dynamic import', async () => {
		makeProvider(
			'leaf',
			'export default { ring0: async () => 123 }',
			`export default ({ ring0, config }) => {
				return { value: ring0, dataDir: config.dataDir, scoped() { return this } }
			}`,
		)

		const loader = new ProviderLoader(testDir, daemonConfig)
		const loaded = await loader.load()

		expect(loaded).toHaveLength(1)
		expect(loaded[0].name).toBe('leaf')
		expect((loaded[0].instance as any).value).toBe(123)
		expect((loaded[0].instance as any).dataDir).toBe(testDir)
	})

	it('loads provider with deps and auto-scoping', async () => {
		makeProvider(
			'root',
			'export default {}',
			`export default ({ }) => {
				const clients = []
				return {
					clients,
					scoped(name) {
						clients.push(name)
						return { scopedFor: name, scoped() { return this } }
					}
				}
			}`,
		)
		makeProvider(
			'child',
			'export default { root: (r) => r }',
			`export default ({ }) => {
				return { ok: true, scoped() { return this } }
			}`,
		)

		const loader = new ProviderLoader(testDir, daemonConfig)
		const loaded = await loader.load()

		expect(loaded).toHaveLength(2)
		expect(loaded[0].name).toBe('root')
		expect(loaded[1].name).toBe('child')
		expect(loaded[0].clients).toEqual(['child'])
	})
})
