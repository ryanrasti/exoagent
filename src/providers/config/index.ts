/**
 * Config provider — unified key-value store for secrets and settings.
 *
 * Single SQLite table: (scope, key, value).
 * Depends on: sqlite
 * .scoped(clientName) → ScopedConfig that filters by scope.
 */

import type { BoundEval } from '../../bound-eval'
import type { ProviderInit } from '../../provider'
import type { ScopedSqlite } from '../sqlite'
import z from 'zod'
import { tool } from '../../exoeval/tool'

export type ConfigCaps = {
	sqlite: ScopedSqlite
}

class ConfigProviderImpl {
	private readonly exoEval: BoundEval<ConfigCaps>

	constructor(exoEval: BoundEval<ConfigCaps>) {
		this.exoEval = exoEval

		this.exoEval(
			({ sqlite }) =>
				sqlite.exec(`
				CREATE TABLE IF NOT EXISTS config (
					scope TEXT NOT NULL,
					key TEXT NOT NULL,
					value TEXT NOT NULL,
					PRIMARY KEY (scope, key)
				)
			`),
		)
	}

	scoped(clientName: string): ScopedConfig {
		return new ScopedConfig(this.exoEval, clientName)
	}
}

export default ({ exoEval }: ProviderInit<ConfigCaps>) => new ConfigProviderImpl(exoEval)

export class ScopedConfig {
	private readonly exoEval: BoundEval<ConfigCaps>
	private readonly scope: string

	constructor(exoEval: BoundEval<ConfigCaps>, scope: string) {
		this.exoEval = exoEval
		this.scope = scope
	}

	@tool(z.string())
	get(key: string): string | null {
		const scope = this.scope
		const row = this.exoEval(
			({ sqlite }) =>
				sqlite.get('SELECT value FROM config WHERE scope = ? AND key = ?', [scope, key]),
			{ scope, key },
		) as { value: string } | null
		return row ? row.value : null
	}

	@tool(z.string(), z.string())
	set(key: string, value: string): { ok: true } {
		const scope = this.scope
		this.exoEval(
			({ sqlite }) =>
				sqlite.run(
					'INSERT OR REPLACE INTO config (scope, key, value) VALUES (?, ?, ?)',
					[scope, key, value],
				),
			{ scope, key, value },
		)
		return { ok: true }
	}

	@tool(z.string())
	delete(key: string): { ok: true } {
		const scope = this.scope
		this.exoEval(
			({ sqlite }) =>
				sqlite.run('DELETE FROM config WHERE scope = ? AND key = ?', [scope, key]),
			{ scope, key },
		)
		return { ok: true }
	}

	@tool()
	list(): string[] {
		const scope = this.scope
		const rows = this.exoEval(
			({ sqlite }) => sqlite.query('SELECT key FROM config WHERE scope = ?', [scope]),
			{ scope },
		) as { key: string }[]
		return rows.map(r => r.key)
	}
}
