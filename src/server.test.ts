import type { LoadedProvider } from './loader'
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

function loaded(name: string, shortName: string, instance: object): LoadedProvider {
	return { name, shortName, uiInstance: instance, clients: [], hasUI: false, status: 'ready' }
}

const app = createApp({
	mock: loaded('@test/providers/mock', 'mock', new MockProvider()),
})

async function rpc(provider: string, code: string): Promise<Response> {
	return app.request(`http://${provider}.localhost/rpc`, {
		method: 'POST',
		body: code,
	})
}

describe('server', () => {
	it('GET /health on dashboard', async () => {
		const res = await app.request('http://localhost/health')
		expect(res.status).toBe(200)
		const data = await res.json() as { status: string, bootMs: number, startedAt: number }
		expect(data.status).toBe('ok')
		expect(data.bootMs).toBe(0)
		expect(typeof data.startedAt).toBe('number')
	})

	it('GET /api/providers', async () => {
		const res = await app.request('http://localhost/api/providers')
		expect(res.status).toBe(200)
		const data = (await res.json()) as { providers: { name: string, shortName: string }[] }
		expect(data.providers.map((p: { shortName: string }) => p.shortName)).toEqual(['mock'])
		expect(data.providers.map((p: { name: string }) => p.name)).toEqual(['@test/providers/mock'])
	})

	it('POST /rpc on unknown subdomain returns 404', async () => {
		const res = await rpc('unknown', 'true')
		expect(res.status).toBe(404)
	})

	it('POST /rpc with empty body returns 400', async () => {
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

	it('GET / on provider subdomain returns HTML', async () => {
		const res = await app.request('http://mock.localhost/')
		expect(res.status).toBe(200)
		const html = await res.text()
		expect(html).toContain('mock')
		expect(html).toContain('x-provider')
	})

	it('GET / on dashboard returns HTML', async () => {
		const res = await app.request('http://localhost/')
		expect(res.status).toBe(200)
		const html = await res.text()
		expect(html).toContain('exoagent')
	})
})
