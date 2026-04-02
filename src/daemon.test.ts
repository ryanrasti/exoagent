import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const httpGetJson = (url: string): Promise<unknown> =>
	new Promise((resolve, reject) => {
		get(url, (res) => {
			let body = ''
			res.on('data', d => body += d)
			res.on('end', () => {
				if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
				resolve(JSON.parse(body))
			})
		}).on('error', reject)
	})

describe('ExoAgent smoke test', () => {
	const workDir = mkdtempSync(join(tmpdir(), 'exoagent-smoke-'))
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

		// Poll until providers are ready
		type ProviderInfo = { shortName: string, status: string }
		let providers: ProviderInfo[] | null = null
		for (let i = 0; i < 20; i++) {
			await new Promise(r => setTimeout(r, 250))
			try {
				const json = await httpGetJson(`http://127.0.0.1:${port}/api/providers`) as { providers: ProviderInfo[] }
				const list = json.providers
				const sqlite = list.find(p => p.shortName === 'sqlite')
				if (sqlite?.status === 'ready') {
					providers = list
					break
				}
			}
			catch { /* not ready */ }
		}

		const byName = (name: string) => providers?.find(p => p.shortName === name)
		expect(providers).not.toBeNull()
		expect(byName('sqlite')?.status).toBe('ready')
		expect(byName('config')?.status).toBe('ready')
		expect(byName('fetch')?.status).toBe('ready')
	}, 15000)
})
