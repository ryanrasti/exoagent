import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import z from 'zod'
import { makeBoundEval } from '../../bound-eval'
import { tool } from '../../exoeval/tool'

// Use real SQLite for inbox tests (it's a queue — need real persistence semantics)
class RealSqlite {
	private readonly db: InstanceType<typeof Database>

	constructor() {
		this.db = new Database(':memory:')
		this.db.pragma('journal_mode = WAL')
	}

	@tool(z.string())
	exec(sql: string): { ok: true } {
		this.db.exec(sql)
		return { ok: true }
	}

	@tool(z.string(), z.array(z.unknown()).optional())
	run(sql: string, params?: unknown[]): { changes: number, lastInsertRowid: number } {
		const stmt = this.db.prepare(sql)
		const info = params ? stmt.run(...params) : stmt.run()
		return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }
	}

	@tool(z.string(), z.array(z.unknown()).optional())
	query(sql: string, params?: unknown[]): unknown[] {
		const stmt = this.db.prepare(sql)
		return params ? stmt.all(...params) : stmt.all()
	}

	@tool(z.string(), z.array(z.unknown()).optional())
	get(sql: string, params?: unknown[]): unknown {
		const stmt = this.db.prepare(sql)
		return (params ? stmt.get(...params) : stmt.get()) ?? null
	}

	close(): void {
		this.db.close()
	}
}

describe('InboxProvider', () => {
	let sqlite: RealSqlite
	let inbox: any

	beforeEach(async () => {
		sqlite = new RealSqlite()
		const { default: createInbox } = await import('./index')
		const exoEval = makeBoundEval<{ sqlite: RealSqlite }>({ sqlite })
		const root = createInbox({ exoEval: exoEval as any, ring0: null, config: { dataDir: '/tmp' } })
		inbox = root.clientProvider('test-exo')
	})

	afterEach(() => {
		sqlite.close()
	})

	it('delivers and peeks a message', () => {
		const { id } = inbox.deliver('agent-1', 'github', 'New PR opened')
		expect(id).toMatch(/^msg_/)

		const msg = inbox.peek('agent-1')
		expect(msg).not.toBeNull()
		expect(msg.body).toBe('New PR opened')
		expect(msg.source).toBe('github')
		expect(msg.acked).toBe(0)
	})

	it('peek returns oldest first', () => {
		inbox.deliver('agent-1', 'github', 'first')
		inbox.deliver('agent-1', 'linear', 'second')

		const msg = inbox.peek('agent-1')
		expect(msg.body).toBe('first')
	})

	it('ack removes message from peek', () => {
		const { id } = inbox.deliver('agent-1', 'github', 'msg')
		inbox.ack(id)

		const msg = inbox.peek('agent-1')
		expect(msg).toBeNull()
	})

	it('count returns pending message count', () => {
		expect(inbox.count('agent-1')).toBe(0)
		inbox.deliver('agent-1', 'github', 'one')
		inbox.deliver('agent-1', 'linear', 'two')
		expect(inbox.count('agent-1')).toBe(2)

		const { id } = inbox.deliver('agent-1', 'matrix', 'three')
		expect(inbox.count('agent-1')).toBe(3)
		inbox.ack(id)
		expect(inbox.count('agent-1')).toBe(2)
	})

	it('pending returns multiple messages', () => {
		inbox.deliver('agent-1', 'github', 'one')
		inbox.deliver('agent-1', 'linear', 'two')
		inbox.deliver('agent-1', 'matrix', 'three')

		const msgs = inbox.pending('agent-1')
		expect(msgs).toHaveLength(3)
		expect(msgs.map((m: any) => m.body)).toEqual(['one', 'two', 'three'])
	})

	it('pending respects limit', () => {
		inbox.deliver('agent-1', 'a', 'one')
		inbox.deliver('agent-1', 'b', 'two')
		inbox.deliver('agent-1', 'c', 'three')

		const msgs = inbox.pending('agent-1', 2)
		expect(msgs).toHaveLength(2)
	})

	it('snooze hides message temporarily', () => {
		const { id } = inbox.deliver('agent-1', 'github', 'snoozed msg')
		inbox.snooze(id, 3600) // snooze for 1 hour

		const msg = inbox.peek('agent-1')
		expect(msg).toBeNull() // hidden

		expect(inbox.count('agent-1')).toBe(0)
	})

	it('messages are scoped per agent', () => {
		inbox.deliver('agent-1', 'github', 'for agent 1')
		inbox.deliver('agent-2', 'linear', 'for agent 2')

		const msg1 = inbox.peek('agent-1')
		expect(msg1.body).toBe('for agent 1')

		const msg2 = inbox.peek('agent-2')
		expect(msg2.body).toBe('for agent 2')

		expect(inbox.count('agent-1')).toBe(1)
		expect(inbox.count('agent-2')).toBe(1)
	})
})
