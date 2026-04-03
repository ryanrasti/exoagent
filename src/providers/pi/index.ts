/**
 * Pi provider — agent factory backed by pi SDK.
 *
 * Creates pi agent sessions in PTYs, one per (client, sessionId).
 * Each PTY runs agent-worker.ts which connects back via IPC for exoeval tool calls.
 *
 * clientProvider(name) returns a ScopedPi scoped to that client's namespace.
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
type Log = { info: (msg: string) => void, debug: (msg: string) => void, warn: (msg: string) => void, error: (msg: string) => void }
type PiCaps = { log: Log }

const MAX_SCROLLBACK = 5000

type Session = {
	client: string
	sessionId: string
	cwd: string
	pty: Pty
	scrollback: string[]
	waiters: Array<(data: string) => void>
	alive: boolean
	cleanup?: () => void
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
	private readonly sessions = new Map<string, Session>()
	private readonly ipcConns = new Map<string, Socket>()
	private readonly capEvals = new Map<string, (code: string) => unknown>()
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

		const dbDir = this.ring0.join(this.dataDir, 'providers', 'pi')
		this.ring0.mkdirSync(dbDir, { recursive: true })
		const db = (this.ring0 as any).Database(this.ring0.join(dbDir, 'inbox.db'))
		this.inbox = new Inbox(db, (this.ring0 as any).now)
	}

	private key(client: string, sessionId: string): string {
		return `${client}:${sessionId}`
	}

	private log(level: 'info' | 'debug' | 'warn' | 'error', msg: string): void {
		this.exoEval.run(({ log }: any) => log[level](msg), { level, msg })
	}

	setCapEvalFactory(factory: typeof this.capEvalFactory): void {
		this.capEvalFactory = factory
	}

	// ── Session lifecycle ────────────────────────────────────

	createSession(
		client: string,
		opts: { sessionId: string, capNames?: string[], cwd?: string, prompt?: string },
	): { sessionId: string, cwd: string } | Promise<{ sessionId: string, cwd: string }> {
		const { sessionId, capNames, prompt } = opts
		const k = this.key(client, sessionId)
		const existing = this.sessions.get(k)
		if (existing) { return { sessionId, cwd: existing.cwd } }

		const cwd = opts.cwd ?? this.ensureCwd(client, sessionId)
		this.ring0.mkdirSync(cwd, { recursive: true })

		if (capNames && capNames.length > 0) {
			return this.createWithIpc(client, sessionId, cwd, capNames, prompt)
		}
		return this.createSimple(client, sessionId, cwd, prompt)
	}

	private ensureCwd(client: string, sessionId: string): string {
		const cwd = this.ring0.join(this.dataDir, 'providers', 'pi', client, sessionId)
		this.ring0.mkdirSync(cwd, { recursive: true })
		return cwd
	}

	private spawnPty(cwd: string, env: { [key: string]: string | undefined }): Pty {
		const workerPath = this.ring0.resolve(process.cwd(), 'src/providers/pi/agent-worker.ts')
		return this.ring0.pty.spawn('npx', ['tsx', workerPath], {
			name: 'xterm-256color',
			cols: 120,
			rows: 40,
			cwd,
			env,
		})
	}

	private createSimple(
		client: string,
		sessionId: string,
		cwd: string,
		prompt?: string,
	): { sessionId: string, cwd: string } {
		const env: { [key: string]: string | undefined } = {
			...process.env,
			TERM: 'xterm-256color',
			EXOAGENT_CWD: cwd,
		}
		if (prompt) { env.EXOAGENT_SYSTEM_PROMPT = prompt }

		const pty = this.spawnPty(cwd, env)
		this.registerSession(client, sessionId, cwd, pty)
		return { sessionId, cwd }
	}

	private async createWithIpc(
		client: string,
		sessionId: string,
		cwd: string,
		capNames: string[],
		prompt?: string,
	): Promise<{ sessionId: string, cwd: string }> {
		// Load .d.ts for agent's exoeval tool description
		const dtsDir = this.ring0.resolve(process.cwd(), 'dist/types/providers')
		const dtsParts: string[] = []
		for (const name of capNames) {
			try {
				const content = this.ring0.readFileSync(this.ring0.join(dtsDir, name, 'index.d.ts'), 'utf-8')
				dtsParts.push(`// --- ${name} ---\n${content}`)
			}
			catch { dtsParts.push(`// --- ${name} --- (no .d.ts found)`) }
		}
		dtsParts.push(`// --- inbox (built-in) ---
export type InboxMessage = { id: number; source: string; body: string; created_at: number }
export declare class AgentInbox {
  peek(): InboxMessage | null
  pending(limit?: number): InboxMessage[]
  count(): number
  ack(messageId: number): { ok: true }
  snooze(messageId: number, seconds: number): { ok: true }
}`)

		// IPC server for exoeval tool calls + steer messages
		const ipcPath = this.ring0.join(this.dataDir, 'providers', 'pi', `${client}-${sessionId}.sock`)
		try { this.ring0.unlinkSync(ipcPath) }
		catch { /* */ }

		const k = this.key(client, sessionId)
		const server = this.ring0.createServer((conn: Socket) => {
			this.ipcConns.set(k, conn)
			// eslint-disable-next-line node/prefer-global/buffer
			conn.on('data', (buf: Buffer) => {
				for (const line of buf.toString().split('\n')) {
					if (!line.trim()) { continue }
					try {
						const msg = JSON.parse(line) as { id: number, code: string }
						const capEval = this.capEvals.get(k)
						if (capEval) {
							const doEval = async () => {
								try {
									const fn = capEval(msg.code)
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
					catch { /* ignore */ }
				}
			})
		})

		await new Promise<void>(resolve => server.listen(ipcPath, resolve))

		// Spawn PTY
		const env: { [key: string]: string | undefined } = {
			...process.env,
			TERM: 'xterm-256color',
			EXOAGENT_CWD: cwd,
			EXOAGENT_IPC: ipcPath,
			EXOAGENT_CAPS_DTS: dtsParts.join('\n\n'),
			...(prompt ? { EXOAGENT_SYSTEM_PROMPT: prompt } : {}),
		}
		const pty = this.spawnPty(cwd, env)
		const session = this.registerSession(client, sessionId, cwd, pty)

		session.cleanup = () => {
			server.close()
			try { this.ring0.unlinkSync(ipcPath) }
			catch { /* */ }
		}

		// Wire up capEval: provider caps + inbox
		const agentKey = `${client}:${sessionId}`
		const agentInbox = this.inbox.agentInbox(agentKey)

		if (this.capEvalFactory) {
			const { boundEval: providerBe, RealFunction, BoundEvalFrom } = this.capEvalFactory(capNames, client)
			const inboxBe = BoundEvalFrom({ inbox: agentInbox })
			const fullBe = providerBe.union(inboxBe)
			this.capEvals.set(k, (code: string) => fullBe.run(new RealFunction(`return ${code}`)() as any))
		}

		// Steer with any pending inbox messages
		this.steerAgent(client, sessionId)

		return { sessionId, cwd }
	}

	// ── Session operations ───────────────────────────────────

	private registerSession(client: string, sessionId: string, cwd: string, pty: Pty): Session {
		const session: Session = { client, sessionId, cwd, pty, scrollback: [], waiters: [], alive: true }

		const k = this.key(client, sessionId)
		pty.onData((data: string) => {
			session.scrollback.push(data)
			if (session.scrollback.length > MAX_SCROLLBACK) {
				session.scrollback.splice(0, session.scrollback.length - MAX_SCROLLBACK)
			}
			// Broadcast to UI readers
			this.uiProviderInstance?.broadcast(k, data)
			// Also resolve any direct waiters (ScopedPi.read)
			const w = session.waiters
			session.waiters = []
			for (const resolve of w) { resolve(data) }
		})

		pty.onExit(() => {
			session.alive = false
			session.cleanup?.()
			this.uiProviderInstance?.broadcastExit(k)
			const w = session.waiters
			session.waiters = []
			for (const resolve of w) { resolve('') }
		})

		this.sessions.set(this.key(client, sessionId), session)
		return session
	}

	getSession(client: string, sessionId: string): Session {
		const s = this.sessions.get(this.key(client, sessionId))
		if (!s) { throw new Error(`no session for ${client}:${sessionId}`) }
		return s
	}

	listSessions(client: string): { sessionId: string, cwd: string, alive: boolean }[] {
		const result: { sessionId: string, cwd: string, alive: boolean }[] = []
		for (const s of this.sessions.values()) {
			if (s.client === client) { result.push({ sessionId: s.sessionId, cwd: s.cwd, alive: s.alive }) }
		}
		return result
	}

	listAllSessions(): { client: string, sessionId: string, cwd: string, alive: boolean }[] {
		return Array.from(this.sessions.values(), s => ({ client: s.client, sessionId: s.sessionId, cwd: s.cwd, alive: s.alive }))
	}

	input(client: string, sessionId: string, data: string): { ok: true } {
		const s = this.getSession(client, sessionId)
		if (s.alive) { s.pty.write(data) }
		return { ok: true }
	}

	read(client: string, sessionId: string): Promise<string> {
		const s = this.getSession(client, sessionId)
		if (!s.alive) { return Promise.resolve('') }
		return new Promise(resolve => s.waiters.push(resolve))
	}

	resize(client: string, sessionId: string, cols: number, rows: number): { ok: true } {
		const s = this.getSession(client, sessionId)
		if (s.alive) { s.pty.resize(cols, rows) }
		return { ok: true }
	}

	destroy(client: string, sessionId: string): { ok: true } {
		const s = this.getSession(client, sessionId)
		if (s.alive) { s.pty.kill() }
		s.cleanup?.()
		this.sessions.delete(this.key(client, sessionId))
		return { ok: true }
	}

	// ── Inbox + steering ─────────────────────────────────────

	deliver(client: string, sessionId: string, source: string, body: string, dedupKey?: string): { id: number } {
		const agentKey = `${client}:${sessionId}`
		this.log('info', `deliver to ${agentKey} from ${source}: ${body.slice(0, 100)}`)
		const result = this.inbox.deliver(agentKey, source, body, dedupKey)
		this.steerAgent(client, sessionId)
		return result
	}

	private steerAgent(client: string, sessionId: string): void {
		const agentKey = `${client}:${sessionId}`
		const session = this.sessions.get(this.key(client, sessionId))
		if (!session?.alive) { return }

		const messages = this.inbox.needsSteer(agentKey, 5)
		if (messages.length === 0) { return }
		this.log('info', `steering ${agentKey} with ${messages.length} message(s)`)

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

		// Send via IPC → agent-worker calls session.sendUserMessage()
		const conn = this.ipcConns.get(this.key(client, sessionId))
		if (conn) {
			conn.write(`${JSON.stringify({ type: 'steer', message: lines.join('\n') })}\n`)
		}

		this.inbox.markSteered(messages.map(m => m.id))
	}

	steerPending(): void {
		for (const agentKey of this.inbox.agentsNeedingSteering()) {
			const sep = agentKey.lastIndexOf(':')
			const client = agentKey.slice(0, sep)
			const sessionId = agentKey.slice(sep + 1)
			if (client && sessionId) { this.steerAgent(client, sessionId) }
		}
	}

	// ── Provider interface ───────────────────────────────────

	clientProvider(clientName: string): ScopedPi {
		return new ScopedPi(this, clientName)
	}

	private uiProviderInstance: PiUiProvider | null = null

	uiProvider(_clients: string[]): PiUiProvider {
		if (!this.uiProviderInstance) {
			this.uiProviderInstance = new PiUiProvider(this)
		}
		return this.uiProviderInstance
	}
}

// ── UI provider ──────────────────────────────────────────────

type Reader = {
	queue: string[]
	waiter: ((data: string) => void) | null
	sessionKey: string | null // which session this reader is subscribed to
}

class PiUiProvider {
	private readonly root: PiProvider
	private readonly readers = new Map<string, Reader>()
	private nextId = 0

	constructor(root: PiProvider) { this.root = root }

	/** Called by server on WS connect. Returns per-connection scoped object. */
	forConnection(): PiWsConnection {
		const id = String(this.nextId++)
		const reader: Reader = { queue: [], waiter: null, sessionKey: null }
		this.readers.set(id, reader)
		return new PiWsConnection(this.root, this, id, reader)
	}

	/** Called by PiProvider when PTY produces output for a session. */
	broadcast(sessionKey: string, data: string): void {
		for (const reader of this.readers.values()) {
			if (reader.sessionKey !== sessionKey) { continue }
			if (reader.waiter) {
				const w = reader.waiter
				reader.waiter = null
				w(data)
			}
			else {
				reader.queue.push(data)
			}
		}
	}

	/** Notify readers that a session exited. */
	broadcastExit(sessionKey: string): void {
		for (const reader of this.readers.values()) {
			if (reader.sessionKey !== sessionKey) { continue }
			if (reader.waiter) {
				const w = reader.waiter
				reader.waiter = null
				w('')
			}
		}
	}

	removeReader(id: string): void {
		const r = this.readers.get(id)
		if (r?.waiter) { r.waiter('') }
		this.readers.delete(id)
	}
}

/** Per-WS-connection object — has its own reader queue. */
class PiWsConnection {
	private readonly root: PiProvider
	private readonly ui: PiUiProvider
	private readonly readerId: string
	private readonly reader: Reader

	constructor(root: PiProvider, ui: PiUiProvider, readerId: string, reader: Reader) {
		this.root = root
		this.ui = ui
		this.readerId = readerId
		this.reader = reader
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
		const k = `${client}:${sessionId}`

		// First read for this session: replay scrollback
		if (this.reader.sessionKey !== k) {
			this.reader.sessionKey = k
			try {
				const s = this.root.getSession(client, sessionId)
				if (s.scrollback.length > 0) {
					return Promise.resolve(s.scrollback.join(''))
				}
				// Empty scrollback — fall through to wait for first output
			}
			catch { return Promise.resolve('') }
		}

		// If queued data, return immediately
		if (this.reader.queue.length > 0) {
			const data = this.reader.queue.join('')
			this.reader.queue.length = 0
			return Promise.resolve(data)
		}

		// Check if session is dead
		try {
			const s = this.root.getSession(client, sessionId)
			if (!s.alive) { return Promise.resolve('') }
		}
		catch { return Promise.resolve('') }

		return new Promise((resolve) => { this.reader.waiter = resolve })
	}

	@tool(z.string(), z.string(), z.number(), z.number())
	resize(client: string, sessionId: string, cols: number, rows: number): { ok: true } {
		return this.root.resize(client, sessionId, cols, rows)
	}

	close(): void {
		this.ui.removeReader(this.readerId)
	}
}

export default (init: ProviderInit<PiCaps>) => new PiProvider(init)
