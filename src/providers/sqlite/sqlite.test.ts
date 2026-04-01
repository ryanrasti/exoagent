import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SqliteProvider from './index'

const testRoot = join(tmpdir(), `exoagent-sqlite-test-${process.pid}`)

const ring0Mock = { Database, mkdirSync, resolve }

describe('SqliteProvider', () => {
	let provider: ReturnType<typeof SqliteProvider>

	beforeEach(() => {
		provider = SqliteProvider({ exoEval: (() => {}) as any, ring0: ring0Mock, config: { dataDir: testRoot } })
	})

	afterEach(async () => {
		provider.close()
		await rm(testRoot, { recursive: true, force: true })
	})

	it('scoped returns ScopedSqlite', () => {
		const scoped = provider.clientProvider('test')
		expect(scoped).toBeDefined()
		expect(typeof scoped.exec).toBe('function')
		expect(typeof scoped.run).toBe('function')
		expect(typeof scoped.query).toBe('function')
		expect(typeof scoped.get).toBe('function')
	})

	it('exec creates table', () => {
		const scoped = provider.clientProvider('test')
		scoped.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
		const row = scoped.get('SELECT count(*) as n FROM t')
		expect(row).toEqual({ n: 0 })
	})

	it('run inserts and returns changes', () => {
		const scoped = provider.clientProvider('test')
		scoped.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
		const result = scoped.run('INSERT INTO t (name) VALUES (?)', ['alice'])
		expect(result.changes).toBe(1)
		expect(result.lastInsertRowid).toBe(1)
	})

	it('query returns all rows', () => {
		const scoped = provider.clientProvider('test')
		scoped.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
		scoped.run('INSERT INTO t (name) VALUES (?)', ['alice'])
		scoped.run('INSERT INTO t (name) VALUES (?)', ['bob'])
		const rows = scoped.query('SELECT name FROM t ORDER BY name')
		expect(rows).toEqual([{ name: 'alice' }, { name: 'bob' }])
	})

	it('get returns single row or null', () => {
		const scoped = provider.clientProvider('test')
		scoped.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
		scoped.run('INSERT INTO t (name) VALUES (?)', ['alice'])
		expect(scoped.get('SELECT name FROM t WHERE id = ?', [1])).toEqual({ name: 'alice' })
		expect(scoped.get('SELECT name FROM t WHERE id = ?', [999])).toBe(null)
	})

	it('different clients get isolated databases', () => {
		const a = provider.clientProvider('clientA')
		const b = provider.clientProvider('clientB')

		a.exec('CREATE TABLE t (val TEXT)')
		a.run('INSERT INTO t (val) VALUES (?)', ['from A'])

		b.exec('CREATE TABLE t (val TEXT)')
		b.run('INSERT INTO t (val) VALUES (?)', ['from B'])

		expect(a.query('SELECT val FROM t')).toEqual([{ val: 'from A' }])
		expect(b.query('SELECT val FROM t')).toEqual([{ val: 'from B' }])
	})

	it('persists across close/reopen', () => {
		const scoped = provider.clientProvider('persist')
		scoped.exec('CREATE TABLE t (val TEXT)')
		scoped.run('INSERT INTO t (val) VALUES (?)', ['hello'])
		provider.close()

		const provider2 = SqliteProvider({ exoEval: (() => {}) as any, ring0: ring0Mock, config: { dataDir: testRoot } })
		const scoped2 = provider2.clientProvider('persist')
		expect(scoped2.query('SELECT val FROM t')).toEqual([{ val: 'hello' }])
		provider2.close()
	})
})
