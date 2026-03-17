import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Daemon } from './daemon'
import { ForgejoServer } from './providers/review'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function nixGit() {
  const git = process.env.EXOAGENT_NIX_GIT
  if (!git) throw new Error('Missing EXOAGENT_NIX_GIT')
  return join(git, 'bin', 'git')
}

const GIT = nixGit()

describe('e2e: daemon → openPR → review', () => {
  let daemon: Daemon
  let root: string
  let repoDir: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'e2e-test-'))
    repoDir = join(root, 'repo')

    // Init main repo
    execFileSync(GIT, ['init', repoDir])
    execFileSync(GIT, ['checkout', '-b', 'main'], { cwd: repoDir })
    await writeFile(join(repoDir, 'README.md'), '# Test Project\n')
    execFileSync(GIT, ['add', '.'], { cwd: repoDir })
    execFileSync(GIT, ['-c', 'user.name=test', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: repoDir })

    ForgejoServer.reset()
    daemon = await Daemon.start({ repoDir, agentId: 'e2e-test' })
  }, 30000)

  afterAll(async () => {
    await daemon.stop()
    ForgejoServer.reset()
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  it('full flow: edit → commit → openPR → review → waitForReview', async () => {
    const cloneDir = daemon.cloneDir

    // 1. Make an edit in the clone (simulating what pi would do)
    await writeFile(join(cloneDir, 'hello.txt'), 'hello from agent\n')
    execFileSync(GIT, ['-C', cloneDir, 'checkout', '-b', 'test-pr'])
    execFileSync(GIT, ['-C', cloneDir, 'add', '-A'])
    execFileSync(GIT, ['-C', cloneDir, 'commit', '-m', 'Add hello file'])

    // 2. Open PR via review cap
    const { pr, url, sha } = await daemon.review.openPR({
      branch: 'test-pr',
      title: 'Add hello file',
      body: 'Test PR from e2e test',
    })

    expect(pr).toBeGreaterThan(0)
    expect(url).toContain('/pulls/')
    console.log(`PR opened: ${url}`)

    // 3. Simulate human approving the PR via Forgejo API
    const { url: baseUrl, reviewerToken } = await daemon.server.ensureRunning()
    console.log(`Submitting review to ${baseUrl} with token ${reviewerToken.slice(0, 8)}...`)
    const resp = await fetch(`${baseUrl}/api/v1/repos/agent/workspace/pulls/${pr}/reviews`, {
      method: 'POST',
      headers: { 'Authorization': `token ${reviewerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'LGTM', event: 'APPROVED' }),
    })
    console.log(`Review response: ${resp.status} ${resp.statusText}`)
    if (!resp.ok)
      console.log('Body:', await resp.text())
    expect(resp.ok).toBe(true)

    // 4. Wait for the review (pass waitAfter so it sees reviews after openPR)
    const result = await daemon.review.waitForReview({ pr, sha })
    expect(result.approved).toBe(true)
    expect(result.body).toBe('LGTM')
    expect(result.pr).toBe(pr)

    console.log('Review result:', result)
  }, 60000)
})
