import type { ConfigCaps } from './index'
import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BoundEval } from '../../bound-eval'
import SqliteProvider from '../sqlite'
import ConfigProvider from './index'

const testRoot = join(tmpdir(), `exoagent-config-test-${process.pid}`)
const daemonConfig = { dataDir: testRoot }
const ring0Mock = { Database, mkdirSync, resolve }

describe('ConfigProvider', () => {
	let sqliteProvider: ReturnType<typeof SqliteProvider>
	let configProvider: ReturnType<typeof ConfigProvider>

	beforeEach(() => {
		sqliteProvider = SqliteProvider({ exoEval: (() => {}) as any, ring0: ring0Mock, config: daemonConfig })
		const scopedSqlite = sqliteProvider.clientProvider('config')
		const exoEval = new BoundEval<ConfigCaps>({ sqlite: scopedSqlite })
		configProvider = ConfigProvider({ exoEval, ring0: null, config: daemonConfig })
	})

	afterEach(async () => {
		sqliteProvider.close()
		await rm(testRoot, { recursive: true, force: true })
	})

	it('get returns null for missing key', () => {
		const scoped = configProvider.clientProvider('github')
		expect(scoped.get('api_key')).toBe(null)
	})

	it('set then get', () => {
		const scoped = configProvider.clientProvider('github')
		scoped.set('api_key', 'ghp_test')
		expect(scoped.get('api_key')).toBe('ghp_test')
	})

	it('set overwrites', () => {
		const scoped = configProvider.clientProvider('github')
		scoped.set('api_key', 'old')
		scoped.set('api_key', 'new')
		expect(scoped.get('api_key')).toBe('new')
	})

	it('delete removes key', () => {
		const scoped = configProvider.clientProvider('github')
		scoped.set('api_key', 'ghp_test')
		scoped.delete('api_key')
		expect(scoped.get('api_key')).toBe(null)
	})

	it('list returns key names', () => {
		const scoped = configProvider.clientProvider('github')
		scoped.set('api_key', 'ghp_test')
		scoped.set('org_id', 'org-123')
		expect(scoped.list().toSorted()).toEqual(['api_key', 'org_id'])
	})

	it('providers are isolated via scoped()', () => {
		const github = configProvider.clientProvider('github')
		const slack = configProvider.clientProvider('slack')
		github.set('token', 'ghp_test')
		slack.set('token', 'xoxb_test')
		expect(github.get('token')).toBe('ghp_test')
		expect(slack.get('token')).toBe('xoxb_test')
	})

	it('delete only affects own scope', () => {
		const github = configProvider.clientProvider('github')
		const slack = configProvider.clientProvider('slack')
		github.set('token', 'ghp_test')
		slack.set('token', 'xoxb_test')
		github.delete('token')
		expect(github.get('token')).toBe(null)
		expect(slack.get('token')).toBe('xoxb_test')
	})

	it('persists across instances', () => {
		configProvider.clientProvider('github').set('token', 'ghp_test')
		sqliteProvider.close()

		const sqlite2 = SqliteProvider({ exoEval: (() => {}) as any, ring0: ring0Mock, config: daemonConfig })
		const exoEval2 = new BoundEval<ConfigCaps>({ sqlite: sqlite2.clientProvider('config') })
		const config2 = ConfigProvider({ exoEval: exoEval2, ring0: null, config: daemonConfig })
		expect(config2.clientProvider('github').get('token')).toBe('ghp_test')
		sqlite2.close()
	})

	it('manages schemas', () => {
		const scoped = configProvider.clientProvider('github')
		scoped.setSchema({
			token: { type: 'string', isRequired: true, isSecret: true },
		})
		expect(scoped.getSchema()).toEqual({
			token: { type: 'string', isRequired: true, isSecret: true },
		})

		const allSchemas = configProvider.getSchemas()
		expect(allSchemas).toEqual({
			github: {
				token: { type: 'string', isRequired: true, isSecret: true },
			},
		})
	})

	it('getAllConfig groups by scope', () => {
		configProvider.clientProvider('github').set('token', 'ghp_123')
		configProvider.clientProvider('slack').set('token', 'xoxb_123')

		expect(configProvider.getAllConfig()).toEqual({
			github: { token: 'ghp_123' },
			slack: { token: 'xoxb_123' },
		})
	})
})
