import { describe, it, expect } from 'vitest'
import { ReviewCap } from './review'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GIT = join(process.env.EXOAGENT_NIX_GIT!, 'bin', 'git')

describe('ReviewCap', () => {
  it('parses GitHub repo from HTTPS origin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-'))
    execFileSync(GIT, ['init', dir])
    execFileSync(GIT, ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/user/repo.git'])

    const review = new ReviewCap({ cloneDir: dir, git: process.env.EXOAGENT_NIX_GIT! })
    // Access private method via any
    const repo = (review as any).getRepo()
    expect(repo).toBe('user/repo')
  })

  it('parses GitHub repo from SSH origin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-'))
    execFileSync(GIT, ['init', dir])
    execFileSync(GIT, ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:org/project.git'])

    const review = new ReviewCap({ cloneDir: dir, git: process.env.EXOAGENT_NIX_GIT! })
    const repo = (review as any).getRepo()
    expect(repo).toBe('org/project')
  })

  it('throws if no GitHub token available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-'))
    execFileSync(GIT, ['init', dir])
    execFileSync(GIT, ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/user/repo.git'])

    const oldToken = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN

    const review = new ReviewCap({ cloneDir: dir, git: process.env.EXOAGENT_NIX_GIT! })
    try {
      expect(() => (review as any).getToken()).toThrow('No GitHub token')
    }
    finally {
      if (oldToken)
        process.env.GITHUB_TOKEN = oldToken
    }
  })

  it('uses GITHUB_TOKEN env var', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-'))
    execFileSync(GIT, ['init', dir])

    const oldToken = process.env.GITHUB_TOKEN
    process.env.GITHUB_TOKEN = 'test-token-123'

    try {
      const review = new ReviewCap({ cloneDir: dir, git: process.env.EXOAGENT_NIX_GIT! })
      const token = (review as any).getToken()
      expect(token).toBe('test-token-123')
    }
    finally {
      if (oldToken)
        process.env.GITHUB_TOKEN = oldToken
      else
        delete process.env.GITHUB_TOKEN
    }
  })

  it('uses explicit token from config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-'))
    execFileSync(GIT, ['init', dir])

    const review = new ReviewCap({ cloneDir: dir, git: process.env.EXOAGENT_NIX_GIT!, token: 'explicit-token' })
    const token = (review as any).getToken()
    expect(token).toBe('explicit-token')
  })
})
