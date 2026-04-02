import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

describe('ExoAgent smoke test', () => {
	const workDir = join(import.meta.dirname, '..', 'examples', 'team')
	let daemon: ReturnType<typeof spawn>

	afterAll(() => {
		daemon?.kill('SIGTERM')
	})

	it('starts, boots providers, serves API', async () => {
		daemon = spawn(
			'npx',
			['tsx', join(import.meta.dirname, 'daemon.ts'), '--port', '0', '--portfd', '1'],
			{
				env: { ...process.env, EXOAGENT_DIR: workDir },
				stdio: ['pipe', 'pipe', 'pipe'],
			},
		)

		// Read port from stdout marker line
		const port = await new Promise<number>((resolve, reject) => {
			let buf = ''
			daemon.stdout!.on('data', (d) => {
				buf += d.toString()
				const match = buf.match(/EXOAGENT_PORT=(\d+)/)
				if (match) { resolve(Number(match[1])) }
			})
			daemon.on('exit', () => reject(new Error(`daemon exited before port: ${buf}`)))
			setTimeout(() => reject(new Error(`timeout waiting for port: ${buf}`)), 10000)
		})
		expect(port).toBeGreaterThan(0)

		// Poll until all providers are ready
		type Provider = { shortName: string, status: string }
		let providers: Provider[] = []
		for (let i = 0; i < 40; i++) {
			await new Promise(r => setTimeout(r, 250))
			try {
				const res = await fetch(`http://127.0.0.1:${port}/api/providers`)
				if (!res.ok) { continue }
				const json = await res.json() as { providers: Provider[] }
				providers = json.providers
				if (providers.every(p => p.status !== 'pending')) { break }
			}
			catch { /* not ready */ }
		}

		// Core providers should be ready (exos may fail in test env)
		const coreProviders = providers.filter(p => p.shortName !== 'hello' && p.shortName !== 'pm')
		for (const p of coreProviders) {
			expect(p.status, `${p.shortName} should be ready`).toBe('ready')
		}
	}, 15000)
})
