import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Secrets } from './secrets'

const testRoot = join(tmpdir(), `exoagent-secrets-test-${process.pid}`)

describe('Secrets', () => {
  let secrets: Secrets

  beforeEach(() => {
    secrets = new Secrets(testRoot)
  })

  afterEach(async () => {
    secrets.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('get returns null for missing secret', () => {
    expect(secrets.get('pi', 'api_key')).toBe(null)
  })

  it('set then get', () => {
    secrets.set('pi', 'api_key', 'sk-ant-test')
    expect(secrets.get('pi', 'api_key')).toBe('sk-ant-test')
  })

  it('set overwrites', () => {
    secrets.set('pi', 'api_key', 'old')
    secrets.set('pi', 'api_key', 'new')
    expect(secrets.get('pi', 'api_key')).toBe('new')
  })

  it('delete removes secret', () => {
    secrets.set('pi', 'api_key', 'sk-ant-test')
    secrets.delete('pi', 'api_key')
    expect(secrets.get('pi', 'api_key')).toBe(null)
  })

  it('providers are isolated', () => {
    secrets.set('pi', 'api_key', 'sk-ant-test')
    secrets.set('github', 'api_key', 'ghp_test')
    expect(secrets.get('pi', 'api_key')).toBe('sk-ant-test')
    expect(secrets.get('github', 'api_key')).toBe('ghp_test')
  })

  it('persists across instances', () => {
    secrets.set('pi', 'api_key', 'sk-ant-test')
    secrets.close()

    const secrets2 = new Secrets(testRoot)
    expect(secrets2.get('pi', 'api_key')).toBe('sk-ant-test')
    secrets2.close()
  })
})
