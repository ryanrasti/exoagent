/**
 * Inbox — durable message queue for pi agents.
 *
 * Backed by SQLite. Each agent has its own queue keyed by `client/sessionId`.
 *
 * Message lifecycle:
 *   new       → steered_at IS NULL, not yet written to agent PTY
 *   steered   → steered_at set, waiting for agent to ack
 *   acked     → done
 *   snoozed   → snoozed_until set, steered_at cleared → becomes "new" after timer
 *
 * Two interfaces:
 * - Inbox: the send/admin side (deliver, needsSteer, markSteered)
 * - AgentInbox: the receive side (peek/ack/snooze/pending) — given to agent as a cap
 */

import type Database from 'better-sqlite3'
import z from 'zod'
import { tool } from '../../exoeval/tool'

export type InboxMessage = {
	id: number
	source: string
	body: string
	created_at: number
}

export class Inbox {
	private readonly db: InstanceType<typeof Database>
	private readonly now: () => number

	constructor(db: InstanceType<typeof Database>, now: () => number) {
		this.db = db
		this.now = now
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS inbox (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				dedup_key TEXT,
				agent_key TEXT NOT NULL,
				source TEXT NOT NULL,
				body TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				acked INTEGER NOT NULL DEFAULT 0,
				steered_at INTEGER,
				snoozed_until INTEGER
			)
		`)
		this.db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_agent ON inbox(agent_key, acked, steered_at, snoozed_until)`)
		this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_dedup ON inbox(dedup_key) WHERE dedup_key IS NOT NULL`)
	}

	/** Deliver a message to an agent's inbox (steered_at = null → needs steering). */
	deliver(agentKey: string, source: string, body: string, dedupKey?: string): { id: number } {
		if (dedupKey) {
			const existing = this.db.prepare('SELECT id FROM inbox WHERE dedup_key = ?').get(dedupKey) as { id: number } | undefined
			if (existing) { return { id: existing.id } }
		}
		const result = this.db.prepare(
			'INSERT INTO inbox (dedup_key, agent_key, source, body, created_at) VALUES (?, ?, ?, ?, ?)',
		).run(dedupKey ?? null, agentKey, source, body, this.now())
		return { id: Number(result.lastInsertRowid) }
	}

	/**
	 * Get messages that need steering for an agent:
	 * - Not acked, not yet steered (steered_at IS NULL)
	 * - Or snoozed and timer expired (snoozed_until <= now, steered_at cleared)
	 */
	needsSteer(agentKey: string, limit?: number): InboxMessage[] {
		const n = limit ?? 5
		return this.db.prepare(
			`SELECT id, source, body, created_at FROM inbox
			 WHERE agent_key = ? AND acked = 0 AND steered_at IS NULL
			   AND (snoozed_until IS NULL OR snoozed_until <= ?)
			 ORDER BY created_at ASC LIMIT ?`,
		).all(agentKey, this.now(), n) as InboxMessage[]
	}

	/** Mark messages as steered (written to agent PTY). */
	markSteered(messageIds: number[]): void {
		const now = this.now()
		const stmt = this.db.prepare('UPDATE inbox SET steered_at = ? WHERE id = ?')
		for (const id of messageIds) {
			stmt.run(now, id)
		}
	}

	/** Get all agent keys that have unsteered messages. */
	agentsNeedingSteering(): string[] {
		const rows = this.db.prepare(
			`SELECT DISTINCT agent_key FROM inbox
			 WHERE acked = 0 AND steered_at IS NULL
			   AND (snoozed_until IS NULL OR snoozed_until <= ?)`,
		).all(this.now()) as { agent_key: string }[]
		return rows.map(r => r.agent_key)
	}

	/** Get the agent-facing inbox for a specific agent. */
	agentInbox(agentKey: string): AgentInbox {
		return new AgentInbox(this.db, agentKey, this.now)
	}
}

/** Agent-facing inbox — the receive side. Given to agents as a cap. */
export class AgentInbox {
	private readonly db: InstanceType<typeof Database>
	private readonly agentKey: string
	private readonly now: () => number

	constructor(db: InstanceType<typeof Database>, agentKey: string, now: () => number) {
		this.db = db
		this.agentKey = agentKey
		this.now = now
	}

	/** Read the oldest unacked, non-snoozed message. */
	@tool()
	peek(): InboxMessage | null {
		const row = this.db.prepare(
			`SELECT id, source, body, created_at FROM inbox
			 WHERE agent_key = ? AND acked = 0
			   AND (snoozed_until IS NULL OR snoozed_until <= ?)
			 ORDER BY created_at ASC LIMIT 1`,
		).get(this.agentKey, this.now()) as InboxMessage | undefined
		return row ?? null
	}

	/** Get all pending (unacked, non-snoozed) messages. */
	@tool(z.number().optional())
	pending(limit?: number): InboxMessage[] {
		const n = limit ?? 10
		return this.db.prepare(
			`SELECT id, source, body, created_at FROM inbox
			 WHERE agent_key = ? AND acked = 0
			   AND (snoozed_until IS NULL OR snoozed_until <= ?)
			 ORDER BY created_at ASC LIMIT ?`,
		).all(this.agentKey, this.now(), n) as InboxMessage[]
	}

	/** Count pending messages. */
	@tool()
	count(): number {
		const row = this.db.prepare(
			`SELECT COUNT(*) as cnt FROM inbox
			 WHERE agent_key = ? AND acked = 0
			   AND (snoozed_until IS NULL OR snoozed_until <= ?)`,
		).get(this.agentKey, this.now()) as { cnt: number }
		return row.cnt
	}

	/** Mark a message as handled. */
	@tool(z.number())
	ack(messageId: number): { ok: true } {
		this.db.prepare('UPDATE inbox SET acked = 1 WHERE id = ? AND agent_key = ?').run(messageId, this.agentKey)
		return { ok: true }
	}

	/** Delay redelivery — clears steered_at so it gets re-steered after timer. */
	@tool(z.number(), z.number())
	snooze(messageId: number, seconds: number): { ok: true } {
		const snoozedUntil = this.now() + (seconds * 1000)
		this.db.prepare(
			'UPDATE inbox SET snoozed_until = ?, steered_at = NULL WHERE id = ? AND agent_key = ?',
		).run(snoozedUntil, messageId, this.agentKey)
		return { ok: true }
	}
}
