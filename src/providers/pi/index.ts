/**
 * Pi provider — agent factory backed by pi SDK.
 *
 * Creates pi agent sessions in PTYs, one per (client, sessionId).
 * Each PTY runs agent-worker.ts which connects back via IPC for exoeval tool calls.
 * UI attaches via long-poll exoRpc (read/input).
 *
 * clientProvider(name) returns a ScopedPi that can only see/create
 * agents under that client's namespace.
 *
 * ring0 provides: pty, resolve, join, homedir, mkdirSync, createServer (net)
 */

import type { Socket } from 'node:net'
import type { BoundEval } from '../../bound-eval'
import type { ProviderInit } from '../../provider'
import type manifest from './manifest'
import z from 'zod'
import { tool } from '../../exoeval/tool'
import { Inbox } from './inbox'

type Ring0 = Awaited<ReturnType<typeof manifest.ring0>>
type Pty = ReturnType<Ring0['pty']['spawn']>

type Log = { trace: (msg: string) => void, debug: (msg: string) => void, info: (msg: string) => void, warn: (msg: string) => void, error: (msg: string) => void }

type PiCaps = {
	log: Log
}

type PtySession = {
	client: string
	sessionId: string
	cwd: string
	ptyProcess: Pty
	outputBuffer: string[]
	waiters: Array<(data: string) => void>
	alive: boolean
	ipcCleanup?: () => void
	ipcConn?: Socket
	capEval?: (code: string) => unknown
}

// ── ScopedPi — what exos receive ──────────────────────────────

export type PiProviderImpl = InstanceType<typeof ScopedPi>

class ScopedPi {
	private readonly root: PiProvider
	private readonly client: string

	constructor(root: PiProvider, client: string) {
		this.root = root
		this.client = client
	}

	@tool(z.object({
		sessionId: z.string(),
		capNames: z.array(z.string()).optional(),
		cwd: z.string().optional(),
		prompt: z.string().optional(),
	}))
	create(opts: {
		sessionId: string
		capNames?: string[]
		cwd?: string
		prompt?: string
	}): { sessionId: string, cwd: string } | Promise<{ sessionId: string, cwd: string }> {
		return this.root.createSession(this.client, opts)
	}

	@tool()
	list(): { sessionId: string, cwd: string, alive: boolean }[] {
		return this.root.listSessions(this.client)
	}

	@tool(z.string(), z.string())
	input(sessionId: string, data: string): { ok: true } {
		return this.root.input(this.client, sessionId, data)
	}

	@tool(z.string())
	read(sessionId: string): Promise<string> {
		return this.root.read(this.client, sessionId)
	}

	@tool(z.string(), z.number(), z.number())
	resize(sessionId: string, cols: number, rows: number): { ok: true } {
		return this.root.resize(this.client, sessionId, cols, rows)
	}

	@tool(z.string())
	destroy(sessionId: string): { ok: true } {
		return this.root.destroy(this.client, sessionId)
	}

	/** Deliver a message to an agent's inbox. */
	@tool(z.string(), z.string(), z.string(), z.string().optional())
	deliver(sessionId: string, source: string, body: string, dedupKey?: string): { id: number } {
		return this.root.deliver(this.client, sessionId, source, body, dedupKey)
	}
}

// ── PiProvider — root singleton ───────────────────────────────

class PiProvider {
	private readonly ring0: Ring0
	private readonly dataDir: string
	private readonly exoEval: BoundEval<PiCaps>
	private readonly sessions = new Map<string, PtySession>()
	private readonly inbox: Inbox
	private capEvalFactory?: (capNames: string[], client: string) => {
		boundEval: { union: (other: any) => any, run: (fn: any, capture?: any) => unknown }
		RealFunction: FunctionConstructor
		BoundEvalFrom: (bindings: { [key: string]: unknown }) => any
	}

	constructor(init: ProviderInit<PiCaps>) {
		this.ring0 = init.ring0 as Ring0
		this.dataDir = init.config.dataDir
		this.exoEval = init.exoEval

		// Create inbox database
		const dbDir = this.ring0.join(this.dataDir, 'providers', 'pi')
		this.ring0.mkdirSync(dbDir, { recursive: true })
		const db = (this.ring0 as any).Database(this.ring0.join(dbDir, 'inbox.db'))
		this.inbox = new Inbox(db, (this.ring0 as any).now)
	}

	private log(level: 'info' | 'debug' | 'warn' | 'error', msg: string): void {
		this.exoEval.run(({ log }: any) => log[level](msg), { level, msg })
	}

	/** Set the capEvalFactory — called by the loader after boot. */
	setCapEvalFactory(factory: (capNames: string[], client: string) => {
		boundEval: { union: (other: any) => any, run: (fn: any, capture?: any) => unknown }
		RealFunction: FunctionConstructor
		BoundEvalFrom: (bindings: { [key: string]: unknown }) => any
	}): void {
		this.capEvalFactory = factory
	}

	private sessionKey(client: string, sessionId: string): string {
		return `${client}:${sessionId}`
	}

	private ensureCwd(client: string, sessionId: string): string {
		const cwd = this.ring0.join(this.dataDir, 'providers', 'pi', client, sessionId)
		this.ring0.mkdirSync(cwd, { recursive: true })
		return cwd
	}

	createSession(
		client: string,
		opts: { sessionId: string, capNames?: string[], cwd?: string, prompt?: string },
	): { sessionId: string, cwd: string } | Promise<{ sessionId: string, cwd: string }> {
		const { sessionId, capNames, prompt } = opts
		const key = this.sessionKey(client, sessionId)
		const existing = this.sessions.get(key)
		if (existing) {
			return { sessionId, cwd: existing.cwd }
		}

		const cwd = opts.cwd ?? this.ensureCwd(client, sessionId)
		this.ring0.mkdirSync(cwd, { recursive: true })

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
			// Add inbox types (built-in cap)
			dtsParts.push(`// --- inbox (built-in) ---
export type InboxMessage = { id: number; source: string; body: string; created_at: number }
export declare class AgentInbox {
  peek(): InboxMessage | null
  pending(limit?: number): InboxMessage[]
  count(): number
  ack(messageId: number): { ok: true }
  snooze(messageId: number, seconds: number): { ok: true }
}`)
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
	): { sessionId: string, cwd: string } {
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
		return { sessionId, cwd }
	}

	private async createWithIpc(
		client: string,
		sessionId: string,
		cwd: string,
		capsDts: string,
		capNames: string[],
		prompt?: string,
	): Promise<{ sessionId: string, cwd: string }> {
		const ipcPath = this.ring0.join(this.dataDir, 'providers', 'pi', `${client}-${sessionId}.sock`)
		try { this.ring0.unlinkSync(ipcPath) }
		catch { /* doesn't exist */ }

		const server = this.ring0.createServer((conn: Socket) => {
			// Store connection for sending steer messages to the worker
			const sess = this.sessions.get(this.sessionKey(client, sessionId))
			if (sess) { sess.ipcConn = conn }

			// eslint-disable-next-line node/prefer-global/buffer
			conn.on('data', (buf: Buffer) => {
				for (const line of buf.toString().split('\n')) {
					if (!line.trim()) { continue }
					try {
						const msg = JSON.parse(line) as { id: number, code: string }
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

		// Build capEval: provider caps from factory + inbox as built-in
		const agentKey = `${client}:${sessionId}`
		const agentInbox = this.inbox.agentInbox(agentKey)

		if (this.capEvalFactory) {
			const { boundEval: providerBe, RealFunction, BoundEvalFrom } = this.capEvalFactory(capNames, client)
			const inboxBe = BoundEvalFrom({ inbox: agentInbox })
			const fullBe = providerBe.union(inboxBe)
			session.capEval = (code: string) => fullBe.run(new RealFunction(`return ${code}`)() as any)
		}

		// Steer agent with any pending inbox messages from previous runs
		this.steerAgent(client, sessionId)

		return { sessionId, cwd }
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

	// ── Methods used by ScopedPi ─────────────────────────────

	listSessions(client: string): { sessionId: string, cwd: string, alive: boolean }[] {
		const result: { sessionId: string, cwd: string, alive: boolean }[] = []
		for (const session of this.sessions.values()) {
			if (session.client === client) {
				result.push({ sessionId: session.sessionId, cwd: session.cwd, alive: session.alive })
			}
		}
		return result
	}

	input(client: string, sessionId: string, data: string): { ok: true } {
		const session = this.sessions.get(this.sessionKey(client, sessionId))
		if (!session) { throw new Error(`no session for ${client}:${sessionId}`) }
		if (!session.alive) { throw new Error(`session ${client}:${sessionId} has exited`) }
		session.ptyProcess.write(data)
		return { ok: true }
	}

	read(client: string, sessionId: string): Promise<string> {
		const session = this.sessions.get(this.sessionKey(client, sessionId))
		if (!session) { throw new Error(`no session for ${client}:${sessionId}`) }

		if (session.outputBuffer.length > 0) {
			const data = session.outputBuffer.join('')
			session.outputBuffer.length = 0
			return Promise.resolve(data)
		}

		if (!session.alive) { return Promise.resolve('') }

		return new Promise<string>((resolve) => { session.waiters.push(resolve) })
	}

	resize(client: string, sessionId: string, cols: number, rows: number): { ok: true } {
		const session = this.sessions.get(this.sessionKey(client, sessionId))
		if (!session) { throw new Error(`no session for ${client}:${sessionId}`) }
		if (session.alive) { session.ptyProcess.resize(cols, rows) }
		return { ok: true }
	}

	destroy(client: string, sessionId: string): { ok: true } {
		const session = this.sessions.get(this.sessionKey(client, sessionId))
		if (!session) { throw new Error(`no session for ${client}:${sessionId}`) }
		if (session.alive) { session.ptyProcess.kill() }
		session.ipcCleanup?.()
		this.sessions.delete(this.sessionKey(client, sessionId))
		return { ok: true }
	}

	deliver(client: string, sessionId: string, source: string, body: string, dedupKey?: string): { id: number } {
		const agentKey = `${client}:${sessionId}`
		this.log('info', `deliver to ${agentKey} from ${source}: ${body.slice(0, 100)}`)
		const result = this.inbox.deliver(agentKey, source, body, dedupKey)
		this.steerAgent(client, sessionId)
		return result
	}

	/** Format pending messages and write to agent's PTY as user input. */
	private steerAgent(client: string, sessionId: string): void {
		const agentKey = `${client}:${sessionId}`
		const session = this.sessions.get(this.sessionKey(client, sessionId))
		if (!session?.alive) {
			this.log('debug', `steer skipped: session ${agentKey} not alive`)
			return
		}

		const messages = this.inbox.needsSteer(agentKey, 5)
		if (messages.length === 0) { return }
		this.log('info', `steering ${agentKey} with ${messages.length} message(s)`)

		// Format steer message
		const lines = ['New messages in your inbox:', '']
		for (const msg of messages) {
			const ago = Math.round(((this.ring0 as any).now() - msg.created_at) / 1000)
			const agoStr = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`
			const bodyPreview = msg.body.length > 200 ? `${msg.body.slice(0, 200)}...` : msg.body
			lines.push(`  [${msg.id}] [${msg.source}] (${agoStr}):`)
			lines.push(`  ${bodyPreview}`)
			lines.push('')
		}
		lines.push('Use inbox.ack(id) when done with each message.')

		// Write to PTY as user input
		// Send steer via IPC — agent-worker calls session.sendUserMessage()
		if (session.ipcConn) {
			session.ipcConn.write(`${JSON.stringify({ type: 'steer', message: lines.join('\n') })}\n`)
		}

		// Mark as steered
		this.inbox.markSteered(messages.map(m => m.id))
	}

	/** Steer all agents with undelivered messages. Called on boot. */
	steerPending(): void {
		for (const agentKey of this.inbox.agentsNeedingSteering()) {
			const sep = agentKey.lastIndexOf(':')
			const client = agentKey.slice(0, sep)
			const sessionId = agentKey.slice(sep + 1)
			if (client && sessionId) {
				this.steerAgent(client, sessionId)
			}
		}
	}

	listAllSessions(): { client: string, sessionId: string, cwd: string, alive: boolean }[] {
		const result: { client: string, sessionId: string, cwd: string, alive: boolean }[] = []
		for (const session of this.sessions.values()) {
			result.push({ client: session.client, sessionId: session.sessionId, cwd: session.cwd, alive: session.alive })
		}
		return result
	}

	// ── Provider interface ───────────────────────────────────

	clientProvider(clientName: string): ScopedPi {
		return new ScopedPi(this, clientName)
	}

	/** UI gets root access to list all sessions across clients. */
	uiProvider(_clients: string[]): PiUiProvider {
		return new PiUiProvider(this)
	}
}

// ── UI provider — lists all sessions ─────────────────────────

class PiUiProvider {
	private readonly root: PiProvider

	constructor(root: PiProvider) {
		this.root = root
	}

	@tool()
	list(): { client: string, sessionId: string, cwd: string, alive: boolean }[] {
		return this.root.listAllSessions()
	}

	@tool(z.string(), z.string(), z.string())
	input(client: string, sessionId: string, data: string): { ok: true } {
		return this.root.input(client, sessionId, data)
	}

	@tool(z.string(), z.string())
	read(client: string, sessionId: string): Promise<string> {
		return this.root.read(client, sessionId)
	}

	@tool(z.string(), z.string(), z.number(), z.number())
	resize(client: string, sessionId: string, cols: number, rows: number): { ok: true } {
		return this.root.resize(client, sessionId, cols, rows)
	}
}

export default (init: ProviderInit<PiCaps>) => new PiProvider(init)
