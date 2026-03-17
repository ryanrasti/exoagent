import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ForgejoServer, ReviewCap } from './review'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function nixPathsFromEnv() {
  const forgejo = process.env.EXOAGENT_NIX_FORGEJO
  const git = process.env.EXOAGENT_NIX_GIT
  if (!forgejo || !git)
    throw new Error('Missing EXOAGENT_NIX_FORGEJO or EXOAGENT_NIX_GIT')
  return { forgejo, git }
}

const NIX = nixPathsFromEnv()
const GIT = join(NIX.git, 'bin', 'git')

function createClone(repoDir: string, cloneDir: string) {
  execFileSync(GIT, ['clone', '--local', repoDir, cloneDir])
  execFileSync(GIT, ['-C', cloneDir, 'config', 'user.name', 'agent'])
  execFileSync(GIT, ['-C', cloneDir, 'config', 'user.email', 'agent@localhost'])
}

function commitOnBranch(cloneDir: string, branch: string, files: Record<string, string>, message: string) {
  execFileSync(GIT, ['-C', cloneDir, 'checkout', '-B', branch])
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(cloneDir, name), content)
  execFileSync(GIT, ['-C', cloneDir, 'add', '-A'])
  execFileSync(GIT, ['-C', cloneDir, 'commit', '-m', message])
}

describe('ReviewCap', () => {
  let server: ForgejoServer
  let review: ReviewCap
  let repoDir: string
  let cloneDir: string
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'review-test-'))
    repoDir = join(root, 'repo')
    cloneDir = join(root, 'clone')

    execFileSync(GIT, ['init', repoDir])
    execFileSync(GIT, ['checkout', '-b', 'main'], { cwd: repoDir })
    await writeFile(join(repoDir, 'README.md'), '# Test\n')
    execFileSync(GIT, ['add', '.'], { cwd: repoDir })
    execFileSync(GIT, ['-c', 'user.name=test', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: repoDir })

    ForgejoServer.reset()
    server = ForgejoServer.create({ repoDir, dataDir: join(root, 'forgejo'), nix: NIX })
    await server.ensureRunning()

    createClone(repoDir, cloneDir)

    review = new ReviewCap({ server, cloneDir, git: NIX.git, pollInterval: 500 })
  }, 30000)

  afterAll(async () => {
    await server.stop()
    ForgejoServer.reset()
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  it('forgejo is running', async () => {
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/)
  })

  it('openPR returns immediately with url and sha', async () => {
    commitOnBranch(cloneDir, 'add-hello', { 'hello.txt': 'hello\n' }, 'Add hello')

    const result = await review.openPR({ branch: 'add-hello', title: 'Add hello', body: 'Test' })
    expect(result.pr).toBeGreaterThan(0)
    expect(result.url).toContain('/pulls/')
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('waitForReview returns on approval', async () => {
    const { pr, sha } = await review.openPR({ branch: 'add-hello', title: 'Add hello' })
    const wait = review.waitForReview({ pr, sha })
    await sleep(500)
    await submitReviewForPr(server, pr, 'APPROVED', 'LGTM')
    const result = await wait
    expect(result.approved).toBe(true)
    expect(result.body).toBe('LGTM')
  }, 10000)

  it('waitForReview returns on change requests with comments', async () => {
    commitOnBranch(cloneDir, 'add-code', { 'code.txt': 'line1\nline2\nline3\n' }, 'Add code')
    const { pr, sha } = await review.openPR({ branch: 'add-code', title: 'Add code' })
    const wait = review.waitForReview({ pr, sha })
    await sleep(500)
    await submitReviewForPr(server, pr, 'REQUEST_CHANGES', 'Fix line 2', [{
      path: 'code.txt', new_position: 2, body: 'This needs work',
    }])
    const result = await wait
    expect(result.approved).toBe(false)
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0].body).toBe('This needs work')
  }, 10000)

  it('waitForReview detects PR close', async () => {
    commitOnBranch(cloneDir, 'bad-code', { 'bad.txt': 'bad\n' }, 'Bad')
    const { pr, sha } = await review.openPR({ branch: 'bad-code', title: 'Bad' })
    const wait = review.waitForReview({ pr, sha })
    await sleep(500)
    await closePr(server, pr)
    const result = await wait
    expect(result.approved).toBe(false)
    expect(result.body).toBe('PR was closed')
  }, 10000)

  it('waitForReview ignores old reviews after new push', async () => {
    // First round: push, get reviewed
    commitOnBranch(cloneDir, 'iterative', { 'iter.txt': 'v1\n' }, 'v1')
    const r1 = await review.openPR({ branch: 'iterative', title: 'Iterative' })
    const w1 = review.waitForReview({ pr: r1.pr, sha: r1.sha })
    await sleep(500)
    await submitReviewForPr(server, r1.pr, 'REQUEST_CHANGES', 'Needs v2')
    expect((await w1).approved).toBe(false)

    // Second round: new commit, push again
    writeFileSync(join(cloneDir, 'iter.txt'), 'v2\n')
    execFileSync(GIT, ['-C', cloneDir, 'add', '-A'])
    execFileSync(GIT, ['-C', cloneDir, 'commit', '-m', 'v2'])
    const r2 = await review.openPR({ branch: 'iterative', title: 'Iterative v2' })
    expect(r2.pr).toBe(r1.pr) // Same PR

    // Wait should ignore the old REQUEST_CHANGES (on old sha)
    const w2 = review.waitForReview({ pr: r2.pr, sha: r2.sha })
    await sleep(500)
    await submitReviewForPr(server, r2.pr, 'APPROVED', 'Good now')
    expect((await w2).approved).toBe(true)
  }, 20000)

  it('waitForReview returns immediately if already reviewed', async () => {
    commitOnBranch(cloneDir, 'already-reviewed', { 'done.txt': 'done\n' }, 'Done')
    const { pr, sha } = await review.openPR({ branch: 'already-reviewed', title: 'Done' })
    // Review BEFORE calling wait
    await submitReviewForPr(server, pr, 'APPROVED', 'Pre-approved')
    // Should return immediately
    const start = Date.now()
    const result = await review.waitForReview({ pr, sha })
    expect(result.approved).toBe(true)
    expect(Date.now() - start).toBeLessThan(2000)
  }, 10000)
})

// -- Helpers ----------------------------------------------------------------

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function submitReviewForPr(
  server: ForgejoServer,
  prNumber: number,
  event: string,
  body: string,
  comments?: Array<{ path: string, new_position: number, body: string }>,
) {
  const { url, reviewerToken } = await server.ensureRunning()
  const payload: any = { body, event }
  if (comments)
    payload.comments = comments
  const resp = await fetch(`${url}/api/v1/repos/agent/workspace/pulls/${prNumber}/reviews`, {
    method: 'POST',
    headers: { 'Authorization': `token ${reviewerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok)
    throw new Error(`submitReview PR#${prNumber} ${event}: ${resp.status} ${await resp.text()}`)
}

async function closePr(server: ForgejoServer, prNumber: number) {
  const { url, agentToken } = await server.ensureRunning()
  await fetch(`${url}/api/v1/repos/agent/workspace/pulls/${prNumber}`, {
    method: 'PATCH',
    headers: { 'Authorization': `token ${agentToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  })
}
