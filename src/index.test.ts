import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('control plane', () => {
	it('GET /health returns ok', async () => {
		const response = await SELF.fetch('http://localhost/health')
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ status: 'ok' })
	})

	it('GET /unknown returns 404', async () => {
		const response = await SELF.fetch('http://localhost/unknown')
		expect(response.status).toBe(404)
	})
})

// loader tests run against wrangler dev, not vitest pool
// (WorkerLoader binding not available in vitest-pool-workers)
