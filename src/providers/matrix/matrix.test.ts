import { describe, expect, it } from 'vitest'
import z from 'zod'
import { BoundEval } from '../../bound-eval'
import { tool } from '../../exoeval/tool'

class MockConfig {
	schemas = new Map<string, object>()
	private store = new Map<string, string>()

	@tool(z.record(z.string(), z.object({ type: z.string(), isRequired: z.boolean().optional(), isSecret: z.boolean().optional(), description: z.string().optional(), default: z.string().optional() })))
	setSchema(schema: object): { ok: true } {
		this.schemas.set('matrix', schema)
		return { ok: true }
	}

	@tool(z.string())
	get(key: string): string | null {
		return this.store.get(key) ?? null
	}

	@tool(z.string(), z.string())
	set(key: string, value: string): { ok: true } {
		this.store.set(key, value)
		return { ok: true }
	}

	setTestValues(values: { [key: string]: string }): void {
		for (const [k, v] of Object.entries(values)) {
			this.store.set(k, v)
		}
	}
}

describe('MatrixProvider', () => {
	const createProvider = async (mockConfig: MockConfig) => {
		const { default: createMatrix } = await import('./index')
		const exoEval = new BoundEval<{ config: MockConfig }>({ config: mockConfig })
		return createMatrix({ exoEval: exoEval as any, ring0: null, config: { dataDir: '/tmp' } })
	}

	it('registers config schema with defaults on construction', async () => {
		const mockConfig = new MockConfig()
		await createProvider(mockConfig)
		expect(mockConfig.schemas.has('matrix')).toBe(true)
		const schema = mockConfig.schemas.get('matrix') as any
		expect(schema.homeserver_url.default).toBe('https://matrix.org')
	})

	it('throws if config missing', async () => {
		const mockConfig = new MockConfig()
		const provider = await createProvider(mockConfig)
		await expect((provider as any).whoami()).rejects.toThrow(/not configured/)
	})

	it('schema has required fields', async () => {
		const mockConfig = new MockConfig()
		await createProvider(mockConfig)
		const schema = mockConfig.schemas.get('matrix') as any
		expect(schema.homeserver_url.isRequired).toBe(true)
		expect(schema.access_token.isRequired).toBe(true)
		expect(schema.access_token.isSecret).toBe(true)
		expect(schema.space_id.isRequired).toBe(true)
	})
})
