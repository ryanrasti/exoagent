/**
 * Pi provider — agent factory backed by pi SDK.
 *
 * Creates pi agent sessions in PTYs, one per (client, sessionId).
 * Each PTY runs agent-worker.ts which connects back via IPC for exoeval tool calls.
 * UI attaches via long-poll exoRpc (read/input).
 *
 * ring0 provides: pty, resolve, join, homedir, mkdirSync, createServer (net)
 */

import type { Socket } from 'node:net'
import type { ProviderInit } from '../../provider'
import type manifest from './manifest'
import z from 'zod'
import { tool } from '../../exoeval/tool'

type Ring0 = Awaited<ReturnType<typeof manifest.ring0>>
type Pty = ReturnType<Ring0['pty']['spawn']>

type PiCaps = Record<string, never>

type PtySession = {
	client: string
	sessionId: string
	cwd: string
	ptyProcess: Pty
	outputBuffer: string[]
	waiters: Array<(data: string) => void>
	alive: boolean
	ipcCleanup?: () => void
	capEval?: (code: string) => unknown
}

export type PiProviderImpl = InstanceType<typeof PiProvider>

class PiProvider {
	private readonly ring0: Ring0
	private readonly dataDir: string
	private readonly sessions = new Map<string, PtySession>()
	private capEvalFactory?: (capNames: string[], client: string) => (code: string) => unknown

	constructor(init: ProviderInit<PiCaps>) {
		this.ring0 = init.ring0 as Ring0
		this.dataDir = init.config.dataDir
	}

	private sessionKey(client: string, sessionId: string): string {
		return `${client}:${sessionId}`
	}

	private ensureCwd(client: string, sessionId: string): string {
		const cwd = this.ring0.join(this.dataDir, 'providers', 'pi', client, sessionId)
		this.ring0.mkdirSync(cwd, { recursive: true })
		return cwd
	}

	@tool(z.string(), z.string(), z.array(z.string()).optional(), z.string().optional(), z.string().optional())
	create(
		client: string,
		sessionId: string,
		capNames?: string[],
		cwdOverride?: string,
		prompt?: string,
	): { client: string, sessionId: string, cwd: string } | Promise<{ client: string, sessionId: string, cwd: string }> {
		const key = this.sessionKey(client, sessionId)
		const existing = this.sessions.get(key)
		if (existing) {
			return { client, sessionId, cwd: existing.cwd }
		}

		const cwd = cwdOverride ?? this.ensureCwd(client, sessionId)
		this.ring0.mkdirSync(cwd, { recursive: true })

		// If cap names are provided, load their .d.ts and set up IPC for exoeval tool calls
		if (capNames && capNames.length > 0) {
			const dtsDir = this.ring0.resolve(process.cwd(), 'dist/types/providers')
			const dtsParts: string[] = []
			for (const name of capNames) {
				try {
					const content = this.ring0.readFileSync(this.ring0.join(dtsDir, name, 'index.d.ts'), 'utf-8')
					dtsParts.push(`// --- ${name} ---\n${content}`)
				}
				catch {
					dtsParts.push(`// --- ${name} --- (no .d.ts found)`)
				}
			}
			const capsDts = dtsParts.join('\n\n')
			return this.createWithIpc(client, sessionId, cwd, capsDts, capNames, prompt)
		}

		return this.createSimple(client, sessionId, cwd, prompt)
	}

	private createSimple(
		client: string,
		sessionId: string,
		cwd: string,
		prompt?: string,
	): { client: string, sessionId: string, cwd: string } {
		const workerPath = this.ring0.resolve(process.cwd(), 'src/providers/pi/agent-worker.ts')
		const env: { [key: string]: string | undefined } = { ...process.env, TERM: 'xterm-256color', EXOAGENT_CWD: cwd }
		if (prompt) { env.EXOAGENT_SYSTEM_PROMPT = prompt }
		const ptyProcess = this.ring0.pty.spawn('npx', ['tsx', workerPath], {
			name: 'xterm-256color',
			cols: 120,
			rows: 40,
			cwd,
			env,
		})
		this.registerSession(client, sessionId, cwd, ptyProcess)
		return { client, sessionId, cwd }
	}

	private async createWithIpc(
		client: string,
		sessionId: string,
		cwd: string,
		capsDts: string,
		capNames: string[],
		prompt?: string,
	): Promise<{ client: string, sessionId: string, cwd: string }> {
		const ipcPath = this.ring0.join(this.dataDir, 'providers', 'pi', `${client}-${sessionId}.sock`)
		// Clean up stale socket
		try { this.ring0.unlinkSync(ipcPath) }
		catch { /* doesn't exist */ }

		// Create IPC server — handles exoeval tool calls from the agent worker
		const server = this.ring0.createServer((conn: Socket) => {
			// eslint-disable-next-line node/prefer-global/buffer
			conn.on('data', (buf: Buffer) => {
				for (const line of buf.toString().split('\n')) {
					if (!line.trim()) { continue }
					try {
						const msg = JSON.parse(line) as { id: number, code: string }
						// The exo that called create() must have set up a capEval on this session
						const session = this.sessions.get(this.sessionKey(client, sessionId))
						if (session?.capEval) {
							const doEval = async () => {
								try {
									const fn = session.capEval!(msg.code)
									const result = fn instanceof Promise ? await fn : fn
									conn.write(`${JSON.stringify({ id: msg.id, result: result ?? null })}\n`)
								}
								catch (err) {
									conn.write(`${JSON.stringify({ id: msg.id, error: err instanceof Error ? err.message : String(err) })}\n`)
								}
							}
							doEval()
						}
						else {
							conn.write(`${JSON.stringify({ id: msg.id, error: 'no capEval registered' })}\n`)
						}
					}
					catch { /* ignore malformed */ }
				}
			})
		})

		await new Promise<void>((resolve) => { server.listen(ipcPath, resolve) })

		const workerPath = this.ring0.resolve(process.cwd(), 'src/providers/pi/agent-worker.ts')
		const ptyProcess = this.ring0.pty.spawn('npx', ['tsx', workerPath], {
			name: 'xterm-256color',
			cols: 120,
			rows: 40,
			cwd,
			env: {
				...process.env,
				TERM: 'xterm-256color',
				EXOAGENT_CWD: cwd,
				EXOAGENT_IPC: ipcPath,
				EXOAGENT_CAPS_DTS: capsDts,
				...(prompt ? { EXOAGENT_SYSTEM_PROMPT: prompt } : {}),
			},
		})

		const session = this.registerSession(client, sessionId, cwd, ptyProcess)
		session.ipcCleanup = () => {
			server.close()
			try { this.ring0.unlinkSync(ipcPath) }
			catch { /* ignore */ }
		}

		// Wire up capEval so IPC tool calls can evaluate against provider caps
		if (this.capEvalFactory) {
			session.capEval = this.capEvalFactory(capNames, client)
		}

		return { client, sessionId, cwd }
	}

	private registerSession(client: string, sessionId: string, cwd: string, ptyProcess: Pty): PtySession {
		const session: PtySession = {
			client,
			sessionId,
			cwd,
			ptyProcess,
			outputBuffer: [],
			waiters: [],
			alive: true,
		}

		ptyProcess.onData((data: string) => {
			if (session.waiters.length > 0) {
				const waiter = session.waiters.shift()!
				waiter(data)
			}
			else {
				session.outputBuffer.push(data)
			}
		})

		ptyProcess.onExit(() => {
			session.alive = false
			session.ipcCleanup?.()
			for (const waiter of session.waiters) {
				waiter('')
			}
			session.waiters.length = 0
		})

		this.sessions.set(this.sessionKey(client, sessionId), session)
		return session
	}

	/** Set the capEvalFactory — called by the loader after boot. */
	setCapEvalFactory(factory: (capNames: string[], client: string) => (code: string) => unknown): void {
		this.capEvalFactory = factory
	}

	@tool()
	list(): { client: string, sessionId: string, cwd: string, alive: boolean }[] {
		const result: { client: string, sessionId: string, cwd: string, alive: boolean }[] = []
		for (const session of this.sessions.values()) {
			result.push({
				client: session.client,
				sessionId: session.sessionId,
				cwd: session.cwd,
				alive: session.alive,
			})
		}
		return result
	}

	@tool(z.string(), z.string(), z.string())
	input(client: string, sessionId: string, data: string): { ok: true } {
		const key = this.sessionKey(client, sessionId)
		const session = this.sessions.get(key)
		if (!session) {
			throw new Error(`no session for ${key}`)
		}
		if (!session.alive) {
			throw new Error(`session ${key} has exited`)
		}
		session.ptyProcess.write(data)
		return { ok: true }
	}

	@tool(z.string(), z.string())
	read(client: string, sessionId: string): Promise<string> {
		const key = this.sessionKey(client, sessionId)
		const session = this.sessions.get(key)
		if (!session) {
			throw new Error(`no session for ${key}`)
		}

		if (session.outputBuffer.length > 0) {
			const data = session.outputBuffer.join('')
			session.outputBuffer.length = 0
			return Promise.resolve(data)
		}

		if (!session.alive) {
			return Promise.resolve('')
		}

		return new Promise<string>((resolve) => {
			session.waiters.push(resolve)
		})
	}

	@tool(z.string(), z.string(), z.number(), z.number())
	resize(client: string, sessionId: string, cols: number, rows: number): { ok: true } {
		const key = this.sessionKey(client, sessionId)
		const session = this.sessions.get(key)
		if (!session) {
			throw new Error(`no session for ${key}`)
		}
		if (session.alive) {
			session.ptyProcess.resize(cols, rows)
		}
		return { ok: true }
	}

	@tool(z.string(), z.string())
	destroy(client: string, sessionId: string): { ok: true } {
		const key = this.sessionKey(client, sessionId)
		const session = this.sessions.get(key)
		if (!session) {
			throw new Error(`no session for ${key}`)
		}
		if (session.alive) {
			session.ptyProcess.kill()
		}
		session.ipcCleanup?.()
		this.sessions.delete(key)
		return { ok: true }
	}

	clientProvider(_clientName: string): PiProviderImpl {
		return this
	}

	uiProvider(_clients: string[]) {
		return this
	}
}

export default (init: ProviderInit<PiCaps>) => new PiProvider(init)
