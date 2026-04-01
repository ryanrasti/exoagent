import { describe, expect, it } from 'vitest'
import z from 'zod'
import { makeBoundEval } from '../../bound-eval'
import { tool } from '../../exoeval/tool'

class MockConfig {
	schemas = new Map<string, object>()
	private store = new Map<string, string>()

	@tool(z.record(z.string(), z.object({ type: z.string(), isRequired: z.boolean().optional(), isSecret: z.boolean().optional(), description: z.string().optional() })))
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

class MockFetch {
	private responses: { status: number, body: string }[] = []

	pushResponse(status: number, body: object): void {
		this.responses.push({ status, body: JSON.stringify(body) })
	}

	@tool(z.string(), z.object({}).passthrough().optional())
	async fetch(_url: string, _options?: object): Promise<{ status: number, body: string }> {
		const resp = this.responses.shift()
		if (!resp) { throw new Error('no mock response') }
		return resp
	}

	@tool(z.array(z.string()))
	allow(_domains: string[]): MockFetch {
		return this
	}
}

const matrixConfig = {
	homeserver_url: 'https://matrix.test',
	access_token: 'test-token',
	room_id: '!room:matrix.test',
}

describe('MatrixProvider', () => {
	const createProvider = async (mockConfig: MockConfig, mockFetch: MockFetch) => {
		const { default: createMatrix } = await import('./index')
		const exoEval = makeBoundEval<{ config: MockConfig, fetch: MockFetch }>({ config: mockConfig, fetch: mockFetch })
		return createMatrix({ exoEval: exoEval as any, ring0: null, config: { dataDir: '/tmp' } })
	}

	it('registers config schema on construction', async () => {
		const mockConfig = new MockConfig()
		const mockFetch = new MockFetch()
		await createProvider(mockConfig, mockFetch)
		expect(mockConfig.schemas.has('matrix')).toBe(true)
	})

	it('whoami calls Matrix API', async () => {
		const mockConfig = new MockConfig()
		mockConfig.setTestValues(matrixConfig)
		const mockFetch = new MockFetch()
		mockFetch.pushResponse(200, { user_id: '@bot:matrix.test' })

		const provider = await createProvider(mockConfig, mockFetch)
		const result = await (provider as any).whoami()
		expect(result).toEqual({ user_id: '@bot:matrix.test' })
	})

	it('sendMessage sends to room', async () => {
		const mockConfig = new MockConfig()
		mockConfig.setTestValues(matrixConfig)
		const mockFetch = new MockFetch()
		mockFetch.pushResponse(200, { event_id: '$event123' })

		const provider = await createProvider(mockConfig, mockFetch)
		const result = await (provider as any).sendMessage('Hello from agent!')
		expect(result).toEqual({ event_id: '$event123' })
	})

	it('getMessages returns filtered messages', async () => {
		const mockConfig = new MockConfig()
		mockConfig.setTestValues(matrixConfig)
		const mockFetch = new MockFetch()
		mockFetch.pushResponse(200, {
			chunk: [
				{ event_id: '$1', sender: '@user:matrix.test', content: { msgtype: 'm.text', body: 'hello' }, origin_server_ts: 1000 },
				{ event_id: '$2', sender: '@bot:matrix.test', content: { msgtype: 'm.image' }, origin_server_ts: 2000 },
				{ event_id: '$3', sender: '@user:matrix.test', content: { msgtype: 'm.text', body: 'world' }, origin_server_ts: 3000 },
			],
		})

		const provider = await createProvider(mockConfig, mockFetch)
		const messages = await (provider as any).getMessages(10)
		expect(messages).toHaveLength(2)
		expect(messages[0].body).toBe('hello')
		expect(messages[1].body).toBe('world')
	})

	it('throws if config missing', async () => {
		const mockConfig = new MockConfig()
		const mockFetch = new MockFetch()
		const provider = await createProvider(mockConfig, mockFetch)
		await expect((provider as any).whoami()).rejects.toThrow(/not configured/)
	})

	it('handles Matrix API errors', async () => {
		const mockConfig = new MockConfig()
		mockConfig.setTestValues(matrixConfig)
		const mockFetch = new MockFetch()
		mockFetch.pushResponse(403, { errcode: 'M_FORBIDDEN', error: 'Forbidden' })

		const provider = await createProvider(mockConfig, mockFetch)
		await expect((provider as any).whoami()).rejects.toThrow(/403/)
	})
})
