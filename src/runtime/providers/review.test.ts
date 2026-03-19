import { describe, it, expect } from 'vitest'
import { ReviewCap } from './review'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GIT = join(JSON.parse(process.env.EXOAGENT_NIX!).git, 'bin', 'git')

function makeReview(opts: { token?: string, agentName?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'review-'))
  execFileSync(GIT, ['init', dir])
  const review = new ReviewCap({
    cloneDir: dir,
    git: JSON.parse(process.env.EXOAGENT_NIX!).git,
    token: opts.token ?? 'test-token',
    repo: 'user/repo',
    agentName: opts.agentName,
  })
  return { review, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('ReviewCap', () => {
  it('token is the value passed in config', () => {
    const { review, cleanup } = makeReview({ token: 'my-token-123' })
    try {
      expect((review as any).token).toBe('my-token-123')
    }
    finally {
      cleanup()
    }
  })

  it('qualifies branch names with agent prefix', () => {
    const { review, cleanup } = makeReview({ agentName: 'test-agent' })
    try {
      expect((review as any).qualifyBranch('my-branch')).toBe('exoagent-test-agent/my-branch')
      expect((review as any).qualifyBranch('exoagent-test-agent/my-branch')).toBe('exoagent-test-agent/my-branch')
    }
    finally {
      cleanup()
    }
  })
})
