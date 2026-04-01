/**
 * Pi provider — agent factory backed by pi SDK.
 *
 * Creates pi agent sessions in PTYs, one per (client, sessionId).
 * UI attaches via long-poll exoRpc (read/input).
 *
 * ring0 provides: piSdk, pty, resolve, join, homedir, mkdirSync
 */

import type { IPty } from 'node-pty'
import type { mkdirSync as MkdirSyncFn } from 'node:fs'
import type { homedir as HomedirFn } from 'node:os'
import type { join as JoinFn, resolve as ResolveFn } from 'node:path'
import type { ProviderInit } from '../../provider'
import z from 'zod'
import { tool } from '../../exoeval/tool'

type PtySpawn = (file: string, args: string[], options: {
	name?: string
	cols?: number
	rows?: number
	cwd?: string
	env?: { [key: string]: string | undefined }
}) => IPty

type PiRing0 = {
	pty: { spawn: PtySpawn }
	resolve: typeof ResolveFn
	join: typeof JoinFn
	homedir: typeof HomedirFn
	mkdirSync: typeof MkdirSyncFn
}

type PiCaps = Record<string, never>

type PtySession = {
	client: string
	sessionId: string
	cwd: string
	ptyProcess: IPty
	outputBuffer: string[]
	waiters: Array<(data: string) => void>
	alive: boolean
}

export type PiProviderImpl = InstanceType<typeof PiProvider>

class PiProvider {
	private readonly ring0: PiRing0
	private readonly dataDir: string
	private readonly sessions = new Map<string, PtySession>()

	constructor(init: ProviderInit<PiCaps>) {
		this.ring0 = init.ring0 as PiRing0
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

	@tool(z.string(), z.string())
	create(client: string, sessionId: string): { client: string, sessionId: string, cwd: string } {
		const key = this.sessionKey(client, sessionId)
		const existing = this.sessions.get(key)
		if (existing) {
			return { client, sessionId, cwd: existing.cwd }
		}

		const cwd = this.ensureCwd(client, sessionId)

		// Spawn pi in interactive mode inside a PTY
		const ptyProcess = this.ring0.pty.spawn('npx', ['pi'], {
			name: 'xterm-256color',
			cols: 120,
			rows: 40,
			cwd,
			env: {
				...process.env,
				TERM: 'xterm-256color',
			},
		})

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
			// If there are waiters, resolve the first one immediately
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
			// Resolve any remaining waiters with empty string
			for (const waiter of session.waiters) {
				waiter('')
			}
			session.waiters.length = 0
		})

		this.sessions.set(key, session)
		return { client, sessionId, cwd }
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

		// If there's buffered output, return it immediately
		if (session.outputBuffer.length > 0) {
			const data = session.outputBuffer.join('')
			session.outputBuffer.length = 0
			return Promise.resolve(data)
		}

		// If the session is dead, return empty
		if (!session.alive) {
			return Promise.resolve('')
		}

		// Otherwise, wait for output (long-poll)
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
