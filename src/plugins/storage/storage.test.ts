import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Storage } from './index'

const TEST_NAMESPACE = '__test__storage__'
const TEST_DIR = join(homedir(), '.exoagent', 'storage', TEST_NAMESPACE)

interface TestSchema {
  'user-prefs': { theme: string, fontSize: number }
  'session': { token: string, expiresAt: number }
}

describe('Storage', () => {
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it('returns null for non-existent key', async () => {
    const store = new Storage<TestSchema>(TEST_NAMESPACE)
    const result = await store.get('user-prefs')
    expect(result).toBeNull()
  })

  it('sets and gets a value', async () => {
    const store = new Storage<TestSchema>(TEST_NAMESPACE)
    await store.set('user-prefs', { theme: 'dark', fontSize: 14 })

    const result = await store.get('user-prefs')
    expect(result).toEqual({ theme: 'dark', fontSize: 14 })
  })

  it('overwrites existing value', async () => {
    const store = new Storage<TestSchema>(TEST_NAMESPACE)
    await store.set('user-prefs', { theme: 'dark', fontSize: 14 })
    await store.set('user-prefs', { theme: 'light', fontSize: 16 })

    const result = await store.get('user-prefs')
    expect(result).toEqual({ theme: 'light', fontSize: 16 })
  })

  it('deletes a value', async () => {
    const store = new Storage<TestSchema>(TEST_NAMESPACE)
    await store.set('session', { token: 'abc', expiresAt: 123 })
    await store.delete('session')

    const result = await store.get('session')
    expect(result).toBeNull()
  })

  it('delete is idempotent', async () => {
    const store = new Storage<TestSchema>(TEST_NAMESPACE)
    await store.delete('session') // doesn't exist
    await store.delete('session') // still doesn't exist
    // no error thrown
  })

  it('lists keys', async () => {
    const store = new Storage<TestSchema>(TEST_NAMESPACE)
    await store.set('user-prefs', { theme: 'dark', fontSize: 14 })
    await store.set('session', { token: 'abc', expiresAt: 123 })

    const keys = await store.list()
    expect(keys.sort()).toEqual(['session', 'user-prefs'])
  })

  it('lists empty when no keys', async () => {
    const store = new Storage<TestSchema>(TEST_NAMESPACE)
    const keys = await store.list()
    expect(keys).toEqual([])
  })

  it('lists after delete', async () => {
    const store = new Storage<TestSchema>(TEST_NAMESPACE)
    await store.set('user-prefs', { theme: 'dark', fontSize: 14 })
    await store.set('session', { token: 'abc', expiresAt: 123 })
    await store.delete('session')

    const keys = await store.list()
    expect(keys).toEqual(['user-prefs'])
  })

  it('rejects invalid namespace', () => {
    expect(() => new Storage<TestSchema>('../bad')).toThrow('Invalid key')
    expect(() => new Storage<TestSchema>('has spaces')).toThrow('Invalid key')
    expect(() => new Storage<TestSchema>('has.dots')).toThrow('Invalid key')
  })

  it('rejects invalid keys', async () => {
    const store = new Storage<TestSchema>(TEST_NAMESPACE)
    await expect(store.get('../etc/passwd' as any)).rejects.toThrow('Invalid key')
    await expect(store.set('foo/bar' as any, {} as any)).rejects.toThrow('Invalid key')
  })

  it('allows valid keys with dashes and underscores', async () => {
    const store = new Storage<TestSchema>(TEST_NAMESPACE)
    await store.set('user-prefs', { theme: 'dark', fontSize: 14 })
    const result = await store.get('user-prefs')
    expect(result).toEqual({ theme: 'dark', fontSize: 14 })
  })
})
