/**
 * Inbox provider — durable message queue per agent.
 *
 * Backed by sqlite. Messages are delivered by event source providers
 * and consumed by agents via peek/ack/snooze.
 *
 * Each client (exo) gets its own scoped inbox.
 */

import type { BoundEval } from '../../bound-eval'
import type { ProviderInit } from '../../provider'
import type { ScopedSqlite } from '../sqlite'
import z from 'zod'
import { tool } from '../../exoeval/tool'

type InboxCaps = {
	sqlite: ScopedSqlite
}

type InboxMessage = {
	id: string
	agent: string
	source: string
	body: string
	created_at: number
	acked: boolean
	snoozed_until: number | null
}

export type InboxProviderImpl = InstanceType<typeof ScopedInbox>

class InboxRoot {
	private readonly exoEval: BoundEval<InboxCaps>

	constructor(exoEval: BoundEval<InboxCaps>) {
		this.exoEval = exoEval

		this.exoEval.run(({ sqlite }) =>
			sqlite.exec(`
				CREATE TABLE IF NOT EXISTS inbox (
					id TEXT PRIMARY KEY,
					agent TEXT NOT NULL,
					source TEXT NOT NULL,
					body TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					acked INTEGER NOT NULL DEFAULT 0,
					snoozed_until INTEGER
				)
			`),
		)
		this.exoEval.run(({ sqlite }) =>
			sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_agent ON inbox(agent, acked, snoozed_until)`),
		)
	}

	clientProvider(clientName: string): ScopedInbox {
		return new ScopedInbox(this.exoEval, clientName)
	}

	uiProvider(_clients: string[]) {
		return this
	}
}

class ScopedInbox {
	private readonly exoEval: BoundEval<InboxCaps>
	private readonly scope: string

	constructor(exoEval: BoundEval<InboxCaps>, scope: string) {
		this.exoEval = exoEval
		this.scope = scope
	}

	/** Deliver a message to an agent's inbox */
	@tool(z.string(), z.string(), z.string())
	deliver(agent: string, source: string, body: string): { id: string } {
		const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
		const createdAt = Date.now()
		const agentKey = `${this.scope}/${agent}`
		this.exoEval.run(
			({ sqlite }) => sqlite.run(
				'INSERT INTO inbox (id, agent, source, body, created_at) VALUES (?, ?, ?, ?, ?)',
				[id, agentKey, source, body, createdAt],
			),
			{ id, agentKey, source, body, createdAt },
		)
		return { id }
	}

	/** Read the oldest unacked, non-snoozed message for an agent */
	@tool(z.string())
	peek(agent: string): InboxMessage | null {
		const now = Date.now()
		const agentKey = `${this.scope}/${agent}`
		const row = this.exoEval.run(
			({ sqlite }) => sqlite.get(
				'SELECT * FROM inbox WHERE agent = ? AND acked = 0 AND (snoozed_until IS NULL OR snoozed_until <= ?) ORDER BY created_at ASC LIMIT 1',
				[agentKey, now],
			),
			{ agentKey, now },
		) as InboxMessage | null
		return row ?? null
	}

	/** Get all pending (unacked, non-snoozed) messages for an agent */
	@tool(z.string(), z.number().optional())
	pending(agent: string, limit?: number): InboxMessage[] {
		const now = Date.now()
		const n = limit ?? 10
		const agentKey = `${this.scope}/${agent}`
		return this.exoEval.run(
			({ sqlite }) => sqlite.query(
				'SELECT * FROM inbox WHERE agent = ? AND acked = 0 AND (snoozed_until IS NULL OR snoozed_until <= ?) ORDER BY created_at ASC LIMIT ?',
				[agentKey, now, n],
			),
			{ agentKey, now, n },
		) as InboxMessage[]
	}

	/** Count pending messages for an agent */
	@tool(z.string())
	count(agent: string): number {
		const now = Date.now()
		const agentKey = `${this.scope}/${agent}`
		const row = this.exoEval.run(
			({ sqlite }) => sqlite.get(
				'SELECT COUNT(*) as cnt FROM inbox WHERE agent = ? AND acked = 0 AND (snoozed_until IS NULL OR snoozed_until <= ?)',
				[agentKey, now],
			),
			{ agentKey, now },
		) as { cnt: number }
		return row.cnt
	}

	/** Mark a message as handled */
	@tool(z.string())
	ack(messageId: string): { ok: true } {
		this.exoEval.run(
			({ sqlite }) => sqlite.run('UPDATE inbox SET acked = 1 WHERE id = ?', [messageId]),
			{ messageId },
		)
		return { ok: true }
	}

	/** Delay redelivery of a message */
	@tool(z.string(), z.number())
	snooze(messageId: string, seconds: number): { ok: true } {
		const snoozedUntil = Date.now() + (seconds * 1000)
		this.exoEval.run(
			({ sqlite }) => sqlite.run('UPDATE inbox SET snoozed_until = ? WHERE id = ?', [snoozedUntil, messageId]),
			{ snoozedUntil, messageId },
		)
		return { ok: true }
	}
}

export default ({ exoEval }: ProviderInit<InboxCaps>) => new InboxRoot(exoEval)
