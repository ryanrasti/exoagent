import { describe, expect, it } from 'vitest'
import z from 'zod'
import { makeBoundEval } from '../../bound-eval'
import { tool } from '../../exoeval/tool'

// Mock config and fetch for testing
class MockConfig {
	private store = new Map<string, string>()
	schemas = new Map<string, object>()

	@tool(z.record(z.string(), z.object({ type: z.string(), isRequired: z.boolean().optional(), isSecret: z.boolean().optional(), description: z.string().optional() })))
	setSchema(schema: object): { ok: true } {
		this.schemas.set('linear', schema)
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

	setTestKey(key: string, value: string): void {
		this.store.set(key, value)
	}
}

class MockFetch {
	private responses: { status: number, body: string }[] = []

	pushResponse(status: number, body: object): void {
		this.responses.push({ status, body: JSON.stringify(body) })
	}

	@tool(z.string(), z.object({}).passthrough().optional())
	async fetch(_url: string, _options?: object): Promise<{ status: number, body: string }> {
		const resp = this.responses.shift()
		if (!resp) {
			throw new Error('no mock response')
		}
		return resp
	}

	@tool(z.array(z.string()))
	allow(_domains: string[]): MockFetch {
		return this
	}
}

describe('LinearProvider', () => {
	const createProvider = async (mockConfig: MockConfig, mockFetch: MockFetch) => {
		const { default: createLinear } = await import('./index')
		const exoEval = makeBoundEval<{ config: MockConfig, fetch: MockFetch }>({ config: mockConfig, fetch: mockFetch })
		return createLinear({ exoEval: exoEval as any, ring0: null, config: { dataDir: '/tmp' } })
	}

	it('registers config schema on construction', async () => {
		const mockConfig = new MockConfig()
		const mockFetch = new MockFetch()
		await createProvider(mockConfig, mockFetch)
		// Schema was registered during construction
		expect(mockConfig.schemas.has('linear')).toBe(true)
	})

	it('getViewer calls GraphQL API', async () => {
		const mockConfig = new MockConfig()
		mockConfig.setTestKey('api_key', 'test-key')
		const mockFetch = new MockFetch()
		mockFetch.pushResponse(200, {
			data: { viewer: { id: '1', name: 'Test User', email: 'test@example.com' } },
		})

		const provider = await createProvider(mockConfig, mockFetch)
		const viewer = await (provider as any).getViewer()
		expect(viewer).toEqual({ id: '1', name: 'Test User', email: 'test@example.com' })
	})

	it('throws if no API key configured', async () => {
		const mockConfig = new MockConfig()
		const mockFetch = new MockFetch()
		const provider = await createProvider(mockConfig, mockFetch)
		await expect((provider as any).getViewer()).rejects.toThrow(/no API key/)
	})

	it('createIssue sends mutation', async () => {
		const mockConfig = new MockConfig()
		mockConfig.setTestKey('api_key', 'test-key')
		const mockFetch = new MockFetch()
		mockFetch.pushResponse(200, {
			data: {
				issueCreate: {
					success: true,
					issue: { id: 'issue-1', identifier: 'ENG-42', url: 'https://linear.app/issue/ENG-42' },
				},
			},
		})

		const provider = await createProvider(mockConfig, mockFetch)
		const issue = await (provider as any).createIssue('team-1', 'Fix bug', 'Description here')
		expect(issue).toEqual({ id: 'issue-1', identifier: 'ENG-42', url: 'https://linear.app/issue/ENG-42' })
	})

	it('handles GraphQL errors', async () => {
		const mockConfig = new MockConfig()
		mockConfig.setTestKey('api_key', 'test-key')
		const mockFetch = new MockFetch()
		mockFetch.pushResponse(200, {
			errors: [{ message: 'Not found' }],
		})

		const provider = await createProvider(mockConfig, mockFetch)
		await expect((provider as any).getViewer()).rejects.toThrow(/Not found/)
	})
})
