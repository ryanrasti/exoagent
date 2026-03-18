import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Daemon } from './daemon'
import { spawnAgent, type Agent } from './spawn'
import { ForgejoServer } from './providers/review'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function nixGit() {
  const git = process.env.EXOAGENT_NIX_GIT
  if (!git) throw new Error('Missing EXOAGENT_NIX_GIT')
  return join(git, 'bin', 'git')
}

const GIT = nixGit()

describe('e2e: spawnAgent → openPR → review', () => {
  let daemon: Daemon
  let agent: Agent
  let root: string
  let repoDir: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'e2e-test-'))
    repoDir = join(root, 'repo')

    execFileSync(GIT, ['init', repoDir])
    execFileSync(GIT, ['checkout', '-b', 'main'], { cwd: repoDir })
    await writeFile(join(repoDir, 'README.md'), '# Test Project\n')
    execFileSync(GIT, ['add', '.'], { cwd: repoDir })
    execFileSync(GIT, ['-c', 'user.name=test', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: repoDir })

    ForgejoServer.reset()
    daemon = await Daemon.start({ repoDir })
    agent = await spawnAgent({
      id: 'e2e-test',
      repoDir,
      dataDir: daemon.dataDir,
      storage: daemon.storage,
      forgejo: daemon.forgejo,
    })
  }, 30000)

  afterAll(async () => {
    agent.pi.dispose()
    await daemon.stop()
    ForgejoServer.reset()
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  it('full flow: edit → commit → openPR → review → waitForReview', async () => {
    // 1. Make an edit
    await writeFile(join(agent.cloneDir, 'hello.txt'), 'hello from agent\n')
    execFileSync(GIT, ['-C', agent.cloneDir, 'checkout', '-b', 'test-pr'])
    execFileSync(GIT, ['-C', agent.cloneDir, 'add', '-A'])
    execFileSync(GIT, ['-C', agent.cloneDir, 'commit', '-m', 'Add hello file'])

    // 2. Open PR
    const { pr, url, sha } = await agent.review.openPR({
      branch: 'test-pr',
      title: 'Add hello file',
      body: 'Test PR from e2e test',
    })
    expect(pr).toBeGreaterThan(0)
    console.log(`PR opened: ${url}`)

    // 3. Approve
    const { url: baseUrl, reviewerToken } = await daemon.forgejo.ensureRunning()
    const resp = await fetch(`${baseUrl}/api/v1/repos/agent/workspace/pulls/${pr}/reviews`, {
      method: 'POST',
      headers: { 'Authorization': `token ${reviewerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'LGTM', event: 'APPROVED' }),
    })
    expect(resp.ok).toBe(true)

    // 4. Wait for review
    const result = await agent.review.waitForReview({ pr, sha })
    expect(result.approved).toBe(true)
    expect(result.body).toBe('LGTM')
    console.log('Review result:', result)
  }, 60000)
})
