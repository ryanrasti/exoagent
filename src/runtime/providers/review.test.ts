import { describe, it, expect } from 'vitest'
import { ReviewCap } from './review'
import { Secrets } from './secrets'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GIT = join(JSON.parse(process.env.EXOAGENT_NIX!).git, 'bin', 'git')

/** Create a mock Secrets instance backed by a temp directory */
function createTestSecrets(token?: string): { secrets: Secrets, cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'review-secrets-'))
  const secrets = Secrets.create(dir)
  if (token) {
    secrets.set('review', 'GITHUB_TOKEN', token)
  }
  return {
    secrets,
    cleanup: () => {
      secrets.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

describe('ReviewCap', () => {
  it('throws if no GITHUB_TOKEN in secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-'))
    const { secrets, cleanup } = createTestSecrets()
    try {
      execFileSync(GIT, ['init', dir])
      const review = new ReviewCap({
        cloneDir: dir,
        git: JSON.parse(process.env.EXOAGENT_NIX!).git,
        secrets,
        repo: 'user/repo',
      })
      expect(() => (review as any).token).toThrow('No GITHUB_TOKEN')
    }
    finally {
      cleanup()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads token from secrets DB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-'))
    const { secrets, cleanup } = createTestSecrets('test-token-123')
    try {
      execFileSync(GIT, ['init', dir])
      const review = new ReviewCap({
        cloneDir: dir,
        git: JSON.parse(process.env.EXOAGENT_NIX!).git,
        secrets,
        repo: 'user/repo',
      })
      expect((review as any).token).toBe('test-token-123')
    }
    finally {
      cleanup()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('qualifies branch names with agent prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-'))
    const { secrets, cleanup } = createTestSecrets('token')
    try {
      execFileSync(GIT, ['init', dir])
      const review = new ReviewCap({
        cloneDir: dir,
        git: JSON.parse(process.env.EXOAGENT_NIX!).git,
        secrets,
        repo: 'user/repo',
        agentName: 'test-agent',
      })
      expect((review as any).qualifyBranch('my-branch')).toBe('exoagent-test-agent/my-branch')
      expect((review as any).qualifyBranch('exoagent-test-agent/my-branch')).toBe('exoagent-test-agent/my-branch')
    }
    finally {
      cleanup()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
