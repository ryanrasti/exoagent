import type { ConfigCaps } from './index'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeBoundEval } from '../../bound-eval'
import SqliteProvider from '../sqlite'
import ConfigProvider from './index'

const testRoot = join(tmpdir(), `exoagent-config-test-${process.pid}`)
const daemonConfig = { dataDir: testRoot }

describe('ConfigProvider', () => {
	let sqliteProvider: ReturnType<typeof SqliteProvider>
	let configProvider: ReturnType<typeof ConfigProvider>

	beforeEach(() => {
		sqliteProvider = SqliteProvider({ exoEval: (() => {}) as any, ring0: Database, config: daemonConfig })
		const scopedSqlite = sqliteProvider.scoped('config')
		const exoEval = makeBoundEval<ConfigCaps>({ sqlite: scopedSqlite })
		configProvider = ConfigProvider({ exoEval, ring0: null, config: daemonConfig })
	})

	afterEach(async () => {
		sqliteProvider.close()
		await rm(testRoot, { recursive: true, force: true })
	})

	it('get returns null for missing key', () => {
		const scoped = configProvider.scoped('github')
		expect(scoped.get('api_key')).toBe(null)
	})

	it('set then get', () => {
		const scoped = configProvider.scoped('github')
		scoped.set('api_key', 'ghp_test')
		expect(scoped.get('api_key')).toBe('ghp_test')
	})

	it('set overwrites', () => {
		const scoped = configProvider.scoped('github')
		scoped.set('api_key', 'old')
		scoped.set('api_key', 'new')
		expect(scoped.get('api_key')).toBe('new')
	})

	it('delete removes key', () => {
		const scoped = configProvider.scoped('github')
		scoped.set('api_key', 'ghp_test')
		scoped.delete('api_key')
		expect(scoped.get('api_key')).toBe(null)
	})

	it('list returns key names', () => {
		const scoped = configProvider.scoped('github')
		scoped.set('api_key', 'ghp_test')
		scoped.set('org_id', 'org-123')
		expect(scoped.list().toSorted()).toEqual(['api_key', 'org_id'])
	})

	it('providers are isolated via scoped()', () => {
		const github = configProvider.scoped('github')
		const slack = configProvider.scoped('slack')
		github.set('token', 'ghp_test')
		slack.set('token', 'xoxb_test')
		expect(github.get('token')).toBe('ghp_test')
		expect(slack.get('token')).toBe('xoxb_test')
	})

	it('delete only affects own scope', () => {
		const github = configProvider.scoped('github')
		const slack = configProvider.scoped('slack')
		github.set('token', 'ghp_test')
		slack.set('token', 'xoxb_test')
		github.delete('token')
		expect(github.get('token')).toBe(null)
		expect(slack.get('token')).toBe('xoxb_test')
	})

	it('persists across instances', () => {
		configProvider.scoped('github').set('token', 'ghp_test')
		sqliteProvider.close()

		const sqlite2 = SqliteProvider({ exoEval: (() => {}) as any, ring0: Database, config: daemonConfig })
		const exoEval2 = makeBoundEval<ConfigCaps>({ sqlite: sqlite2.scoped('config') })
		const config2 = ConfigProvider({ exoEval: exoEval2, ring0: null, config: daemonConfig })
		expect(config2.scoped('github').get('token')).toBe('ghp_test')
		sqlite2.close()
	})
})
