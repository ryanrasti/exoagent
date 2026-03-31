import { describe, expect, it } from 'vitest'
import z from 'zod'
import { tool } from './exoeval/tool'
import { createApp } from './server'

class MockProvider {
	@tool(z.string())
	greet(name: string): string {
		return `hello ${name}`
	}

	@tool(z.number(), z.number())
	add(a: number, b: number): number {
		return a + b
	}

	@tool()
	async asyncOp(): Promise<{ status: string }> {
		return { status: 'done' }
	}
}

const app = createApp({
	mock: { instance: new MockProvider() },
})

async function rpc(provider: string, code: string): Promise<Response> {
	return app.request(`/api/${provider}`, {
		method: 'POST',
		body: code,
	})
}

describe('server', () => {
	it('GET /health', async () => {
		const res = await app.request('/health')
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ status: 'ok' })
	})

	it('GET /api/providers', async () => {
		const res = await app.request('/api/providers')
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ providers: ['mock'] })
	})

	it('POST /api/unknown returns 404', async () => {
		const res = await rpc('unknown', 'true')
		expect(res.status).toBe(404)
	})

	it('POST /api/mock with empty body returns 400', async () => {
		const res = await rpc('mock', '')
		expect(res.status).toBe(400)
	})

	it('exoeval RPC: call @tool() method', async () => {
		const res = await rpc('mock', 'mock.greet("world")')
		expect(res.status).toBe(200)
		expect(await res.json()).toBe('hello world')
	})

	it('exoeval RPC: arithmetic @tool()', async () => {
		const res = await rpc('mock', 'mock.add(2, 3)')
		expect(res.status).toBe(200)
		expect(await res.json()).toBe(5)
	})

	it('exoeval RPC: async @tool()', async () => {
		const res = await rpc('mock', 'mock.asyncOp()')
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ status: 'done' })
	})

	it('exoeval RPC: error returns 500', async () => {
		const res = await rpc('mock', 'mock.greet(42)')
		expect(res.status).toBe(500)
	})

	it('exoeval RPC: cannot access non-tool methods', async () => {
		const res = await rpc('mock', 'mock.toString()')
		expect(res.status).toBe(500)
	})
})
