import { rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StorageCap } from './storage'

const testRoot = join(tmpdir(), `exoagent-storage-test-${process.pid}`)

describe('StorageCap', () => {
  let storage: StorageCap

  beforeEach(() => {
    storage = new StorageCap(testRoot)
  })

  afterEach(async () => {
    storage.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  describe('KV', () => {
    it('get returns null for missing key', async () => {
      expect(await storage.get('missing')).toBe(null)
    })

    it('set then get', async () => {
      await storage.set('key', 'value')
      expect(await storage.get('key')).toBe('value')
    })

    it('set overwrites', async () => {
      await storage.set('key', 'first')
      await storage.set('key', 'second')
      expect(await storage.get('key')).toBe('second')
    })

    it('delete removes key', async () => {
      await storage.set('key', 'value')
      await storage.delete('key')
      expect(await storage.get('key')).toBe(null)
    })

    it('stores objects', async () => {
      await storage.set('obj', { a: 1, b: [2, 3] })
      expect(await storage.get('obj')).toEqual({ a: 1, b: [2, 3] })
    })

    it('persists across instances', async () => {
      await storage.set('persist', 'yes')
      storage.close()

      const storage2 = new StorageCap(testRoot)
      expect(await storage2.get('persist')).toBe('yes')
      storage2.close()
    })

    it('concurrent sets all visible', async () => {
      await Promise.all([
        storage.set('a', 1),
        storage.set('b', 2),
        storage.set('c', 3),
      ])
      expect(await storage.get('a')).toBe(1)
      expect(await storage.get('b')).toBe(2)
      expect(await storage.get('c')).toBe(3)
    })

    it('proto key is safe', async () => {
      await storage.set('__proto__', 'attack')
      expect(await storage.get('__proto__')).toBe('attack')
    })
  })

  describe('provider scoping', () => {
    it('different providers see different keys', async () => {
      const capA = new StorageCap(testRoot, 'providerA')
      const capB = new StorageCap(testRoot, 'providerB')

      await capA.set('key', 'fromA')
      await capB.set('key', 'fromB')

      expect(await capA.get('key')).toBe('fromA')
      expect(await capB.get('key')).toBe('fromB')

      capA.close()
      capB.close()
    })

    it('delete only affects own provider', async () => {
      const capA = new StorageCap(testRoot, 'providerA')
      const capB = new StorageCap(testRoot, 'providerB')

      await capA.set('key', 'fromA')
      await capB.set('key', 'fromB')
      await capA.delete('key')

      expect(await capA.get('key')).toBe(null)
      expect(await capB.get('key')).toBe('fromB')

      capA.close()
      capB.close()
    })
  })

  describe('dir', () => {
    it('creates directory and returns absolute path', async () => {
      const path = await storage.dir('agents/test-123')
      expect(path).toBe(join(testRoot, 'agents/test-123'))
      const s = await stat(path)
      expect(s.isDirectory()).toBe(true)
    })

    it('is idempotent', async () => {
      const path1 = await storage.dir('mydir')
      const path2 = await storage.dir('mydir')
      expect(path1).toBe(path2)
    })

    it('rejects path traversal', async () => {
      await expect(storage.dir('../escape')).rejects.toThrow('escapes storage root')
    })

    it('rejects absolute paths', async () => {
      await expect(storage.dir('/etc/passwd')).rejects.toThrow('escapes storage root')
    })

    it('rejects reserved name', async () => {
      await expect(storage.dir('storage.db')).rejects.toThrow('reserved')
    })
  })
})
