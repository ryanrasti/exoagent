/**
 * Config provider — unified key-value store for secrets and settings.
 *
 * Provides schema declaration and secure storage.
 * Table: (scope, key, value, type, isRequired, isSecret)
 *
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

export type ConfigFieldSchema = {
	type: 'string' | 'number' | 'boolean'
	isRequired?: boolean
	isSecret?: boolean
	description?: string
	default?: string
}

const fieldSchemaZod = z.object({
	type: z.enum(['string', 'number', 'boolean']),
	isRequired: z.boolean().optional(),
	isSecret: z.boolean().optional(),
	description: z.string().optional(),
	default: z.string().optional(),
})

export class ConfigProviderImpl {
	private readonly exoEval: BoundEval<ConfigCaps>
	private readonly schemas = new Map<string, { [key: string]: ConfigFieldSchema }>()

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

	clientProvider(clientName: string): ScopedConfig {
		return new ScopedConfig(this.exoEval, clientName, this.schemas)
	}

	uiProvider(_clients: string[]) {
		return this
	}

	// Exposed to the config provider's UI/RPC (unscoped) to manage all scopes
	@tool()
	getSchemas(): { [scope: string]: { [key: string]: ConfigFieldSchema } } {
		return Object.fromEntries(this.schemas.entries())
	}

	@tool()
	getAllConfig(): { [scope: string]: { [key: string]: string } } {
		const rows = this.exoEval(({ sqlite }) =>
			sqlite.query('SELECT scope, key, value FROM config ORDER BY scope, key'),
		) as { scope: string, key: string, value: string }[]

		const result: { [scope: string]: { [key: string]: string } } = {}
		for (const row of rows) {
			if (!result[row.scope]) { result[row.scope] = {} }
			result[row.scope][row.key] = row.value
		}
		return result
	}

	@tool(z.string(), z.string(), z.string())
	setGlobal(scope: string, key: string, value: string): { ok: true } {
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
}

export default ({ exoEval }: ProviderInit<ConfigCaps>) => new ConfigProviderImpl(exoEval)

export class ScopedConfig {
	private readonly exoEval: BoundEval<ConfigCaps>
	private readonly scope: string
	private readonly schemas: Map<string, { [key: string]: ConfigFieldSchema }>

	constructor(
		exoEval: BoundEval<ConfigCaps>,
		scope: string,
		schemas: Map<string, { [key: string]: ConfigFieldSchema }>,
	) {
		this.exoEval = exoEval
		this.scope = scope
		this.schemas = schemas
	}

	@tool(z.record(z.string(), fieldSchemaZod))
	setSchema(schema: { [key: string]: ConfigFieldSchema }): { ok: true } {
		this.schemas.set(this.scope, schema)
		return { ok: true }
	}

	@tool()
	getSchema(): { [key: string]: ConfigFieldSchema } {
		return this.schemas.get(this.scope) ?? {}
	}

	@tool(z.string())
	get(key: string): string | null {
		const scope = this.scope
		const row = this.exoEval(
			({ sqlite }) =>
				sqlite.get('SELECT value FROM config WHERE scope = ? AND key = ?', [scope, key]),
			{ scope, key },
		) as { value: string } | null
		if (row) { return row.value }
		const schema = this.schemas.get(this.scope)
		return schema?.[key]?.default ?? null
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
