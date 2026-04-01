import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ProviderLoader } from './loader'
import 'ses'

const RealFunction = Function

if (typeof Compartment === 'undefined') {
	lockdown({ errorTaming: 'unsafe', overrideTaming: 'severe', consoleTaming: 'unsafe' })
}

const testDir = join(tmpdir(), `exoagent-loader-test-${process.pid}`)
const testDistDir = join(tmpdir(), `exoagent-loader-dist-${process.pid}`)
const daemonConfig = { dataDir: testDir }
const testNs = '@test/providers'

const testScanDir = () => ({ src: testDir, dist: testDistDir, namespace: testNs })

const makeProvider = (name: string, manifest: string, indexTs?: string) => {
	const dir = resolve(testDir, name)
	mkdirSync(dir, { recursive: true })
	writeFileSync(resolve(dir, 'manifest.ts'), manifest)
	if (indexTs) {
		writeFileSync(resolve(dir, 'index.ts'), indexTs)
		const distDir = resolve(testDistDir, name)
		mkdirSync(distDir, { recursive: true })
		writeFileSync(resolve(distDir, 'index.js'), indexTs)
	}
}

describe('ProviderLoader.scan', () => {
	beforeEach(() => { mkdirSync(testDir, { recursive: true }); mkdirSync(testDistDir, { recursive: true }) })
	afterEach(() => { rmSync(testDir, { recursive: true, force: true }); rmSync(testDistDir, { recursive: true, force: true }) })

	it('scans directories with manifest.ts', () => {
		makeProvider('alpha', 'export default {}')
		makeProvider('beta', 'export default {}')

		const loader = new ProviderLoader([testScanDir()], daemonConfig)
		const defs = loader.scan()
		expect(defs.map(d => d.shortName).toSorted()).toEqual(['alpha', 'beta'])
		expect(defs.map(d => d.name).toSorted()).toEqual([`${testNs}/alpha`, `${testNs}/beta`])
	})

	it('skips directories without manifest.ts', () => {
		mkdirSync(resolve(testDir, 'no-manifest'), { recursive: true })

		const loader = new ProviderLoader([testScanDir()], daemonConfig)
		expect(loader.scan()).toHaveLength(0)
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

		const loader = new ProviderLoader([testScanDir()], daemonConfig)
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

		const loader = new ProviderLoader([testScanDir()], daemonConfig)
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

		const loader = new ProviderLoader([testScanDir()], daemonConfig)
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
			shortName: name,
			dir: '',
			bundlePath: '',
			parsed: { ring0Source: null, ring0Result: undefined, attenuations, deps },
			hasUI: false,
		}
	}

	it('sorts leaves first', () => {
		const loader = new ProviderLoader([{ src: tmpdir(), dist: tmpdir(), namespace: '@test/providers' }], daemonConfig)
		const sorted = loader.dagSort([def('b', ['a']), def('a', [])])
		expect(sorted.map(d => d.name)).toEqual(['a', 'b'])
	})

	it('alphabetical tie-breaking', () => {
		const loader = new ProviderLoader([{ src: tmpdir(), dist: tmpdir(), namespace: '@test/providers' }], daemonConfig)
		const sorted = loader.dagSort([def('c', []), def('a', []), def('b', [])])
		expect(sorted.map(d => d.name)).toEqual(['a', 'b', 'c'])
	})

	it('diamond dependency', () => {
		const loader = new ProviderLoader([{ src: tmpdir(), dist: tmpdir(), namespace: '@test/providers' }], daemonConfig)
		const sorted = loader.dagSort([
			def('d', ['b', 'c']),
			def('b', ['a']),
			def('c', ['a']),
			def('a', []),
		])
		expect(sorted.map(d => d.name)).toEqual(['a', 'b', 'c', 'd'])
	})

	it('throws on cycle', () => {
		const loader = new ProviderLoader([{ src: tmpdir(), dist: tmpdir(), namespace: '@test/providers' }], daemonConfig)
		expect(() => loader.dagSort([def('a', ['b']), def('b', ['a'])])).toThrow(/cycle/)
	})

	it('throws on unknown dep', () => {
		const loader = new ProviderLoader([{ src: tmpdir(), dist: tmpdir(), namespace: '@test/providers' }], daemonConfig)
		expect(() => loader.dagSort([def('a', ['missing'])])).toThrow(/unknown provider/)
	})
})

describe('ProviderLoader.load', () => {
	beforeEach(() => { mkdirSync(testDir, { recursive: true }); mkdirSync(testDistDir, { recursive: true }) })
	afterEach(() => { rmSync(testDir, { recursive: true, force: true }); rmSync(testDistDir, { recursive: true, force: true }) })

	it('loads ring0 provider via dynamic import', async () => {
		makeProvider(
			'leaf',
			'export default { ring0: async () => 123 }',
			`export default ({ ring0, config }) => {
				return { 
					clientProvider() { return { value: ring0, dataDir: config.dataDir } },
					uiProvider() { return { value: ring0, dataDir: config.dataDir } }
				}
			}`,
		)

		const loader = new ProviderLoader([testScanDir()], daemonConfig)
		const { loaded } = await loader.load(RealFunction)

		expect(loaded).toHaveLength(1)
		expect(loaded[0].shortName).toBe('leaf')
		expect(loaded[0].name).toBe(`${testNs}/leaf`)
		expect((loaded[0].uiInstance as any).value).toBe(123)
		expect((loaded[0].uiInstance as any).dataDir).toBe(testDir)
	})

	it('loads provider with deps and auto-scoping', async () => {
		makeProvider(
			'root',
			'export default {}',
			`export default ({ }) => {
				const clients = []
				return {
					clientProvider(name) {
						clients.push(name)
						return { scopedFor: name }
					},
					uiProvider() {
						return { clients }
					}
				}
			}`,
		)
		makeProvider(
			'child',
			`export default { '${testNs}/root': (r) => r }`,
			`export default ({ }) => {
				return {
					clientProvider() { return { ok: true } },
					uiProvider() { return { ok: true } }
				}
			}`,
		)

		const loader = new ProviderLoader([testScanDir()], daemonConfig)
		const { loaded } = await loader.load(RealFunction)

		expect(loaded).toHaveLength(2)
		expect(loaded[0].shortName).toBe('root')
		expect(loaded[1].shortName).toBe('child')
		expect(loaded[0].clients).toEqual([`${testNs}/child`])
		expect((loaded[0].uiInstance as any).clients).toEqual([`${testNs}/child`])
		expect((loaded[1].uiInstance as any).ok).toBe(true)
	})
})
