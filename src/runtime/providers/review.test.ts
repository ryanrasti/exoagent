import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ForgejoServer, ReviewCap } from './review'
import { mkdtemp, writeFile } from 'node:fs/promises'
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

/** Create a local clone of the main repo (like PiCap would) */
function createClone(repoDir: string, cloneDir: string) {
  execFileSync(GIT, ['clone', '--local', repoDir, cloneDir])
  // Configure git user for commits
  execFileSync(GIT, ['-C', cloneDir, 'config', 'user.name', 'agent'])
  execFileSync(GIT, ['-C', cloneDir, 'config', 'user.email', 'agent@localhost'])
}

/** Simulate pi: create branch, edit files, commit */
function commitOnBranch(cloneDir: string, branch: string, files: Record<string, string>, message: string) {
  execFileSync(GIT, ['-C', cloneDir, 'checkout', '-B', branch])
  for (const [name, content] of Object.entries(files))
    execFileSync(GIT, ['-C', cloneDir, 'hash-object', '-w', '--stdin'], { input: content }) // just to be safe
  // writeFileSync is simpler
  const { writeFileSync } = require('node:fs')
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

    // Init main repo with a commit
    execFileSync(GIT, ['init', repoDir])
    execFileSync(GIT, ['checkout', '-b', 'main'], { cwd: repoDir })
    await writeFile(join(repoDir, 'README.md'), '# Test\n')
    execFileSync(GIT, ['add', '.'], { cwd: repoDir })
    execFileSync(GIT, ['-c', 'user.name=test', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: repoDir })

    // Start Forgejo
    ForgejoServer.reset()
    server = ForgejoServer.create({ repoDir, dataDir: join(root, 'forgejo'), nix: NIX })
    await server.ensureRunning()

    // Create local clone (simulates what PiCap would do)
    createClone(repoDir, cloneDir)

    review = new ReviewCap({
      server,
      cloneDir,
      git: NIX.git,
      pollInterval: 500,
    })
  }, 30000)

  afterAll(async () => {
    await server.stop()
    ForgejoServer.reset()
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  it('forgejo is running', async () => {
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/)
    const resp = await fetch(`${server.url}/api/v1/version`)
    expect(resp.ok).toBe(true)
  })

  it('proposes a branch and gets approved', async () => {
    // Pi creates a branch and commits
    commitOnBranch(cloneDir, 'add-hello', { 'hello.txt': 'hello world\n' }, 'Add hello file')

    // Pi proposes the branch
    const proposePromise = review.propose({
      branch: 'add-hello',
      title: 'Add hello file',
      body: 'This adds a greeting',
    })

    // Human approves
    await sleep(1000)
    await submitReview(server, 'APPROVED', 'LGTM')

    const result = await proposePromise
    expect(result.approved).toBe(true)
    expect(result.body).toBe('LGTM')
    expect(result.pr).toBeGreaterThan(0)
  }, 15000)

  it('proposes and gets change requests with comments', async () => {
    commitOnBranch(cloneDir, 'add-code', { 'code.txt': 'line1\nline2\nline3\n' }, 'Add code')

    const proposePromise = review.propose({ branch: 'add-code', title: 'Add code' })

    await sleep(1000)
    await submitReview(server, 'REQUEST_CHANGES', 'Fix line 2', [{
      path: 'code.txt',
      new_position: 2,
      body: 'This line needs work',
    }])

    const result = await proposePromise
    expect(result.approved).toBe(false)
    expect(result.body).toBe('Fix line 2')
    expect(result.comments).toHaveLength(1)
    expect(result.comments[0].path).toBe('code.txt')
    expect(result.comments[0].body).toBe('This line needs work')
  }, 15000)

  it('detects PR close as rejection', async () => {
    commitOnBranch(cloneDir, 'bad-code', { 'bad.txt': 'bad\n' }, 'Bad code')

    const proposePromise = review.propose({ branch: 'bad-code', title: 'Bad code' })

    await sleep(1000)
    await closeLatestPr(server)

    const result = await proposePromise
    expect(result.approved).toBe(false)
    expect(result.body).toBe('PR was closed')
  }, 15000)

  it('re-proposes same branch after feedback (force-push update)', async () => {
    // First proposal
    commitOnBranch(cloneDir, 'iterative', { 'iter.txt': 'v1\n' }, 'First attempt')
    const p1 = review.propose({ branch: 'iterative', title: 'Iterative change' })
    await sleep(1000)
    await submitReview(server, 'REQUEST_CHANGES', 'Needs v2')
    const r1 = await p1
    expect(r1.approved).toBe(false)

    // Pi iterates: amend or new commit on same branch
    const { writeFileSync } = require('node:fs')
    writeFileSync(join(cloneDir, 'iter.txt'), 'v2\n')
    execFileSync(GIT, ['-C', cloneDir, 'add', '-A'])
    execFileSync(GIT, ['-C', cloneDir, 'commit', '-m', 'Address feedback'])

    // Re-propose same branch (force-pushes)
    const p2 = review.propose({ branch: 'iterative', title: 'Iterative change v2' })
    await sleep(1000)
    await submitReview(server, 'APPROVED', 'Looks good now')
    const r2 = await p2
    expect(r2.approved).toBe(true)
  }, 20000)

  it('multiple branches as separate PRs', async () => {
    // Propose feature A
    commitOnBranch(cloneDir, 'feature-a', { 'a.txt': 'a\n' }, 'Feature A')
    const pa = review.propose({ branch: 'feature-a', title: 'Feature A' })
    await sleep(1000)
    await submitReview(server, 'APPROVED', 'ok')
    const ra = await pa

    // Propose feature B
    commitOnBranch(cloneDir, 'feature-b', { 'b.txt': 'b\n' }, 'Feature B')
    const pb = review.propose({ branch: 'feature-b', title: 'Feature B' })
    await sleep(1000)
    await submitReviewForBranch(server, 'feature-b', 'APPROVED', 'ok')
    const rb = await pb

    expect(ra.approved).toBe(true)
    expect(rb.approved).toBe(true)
    expect(ra.pr).not.toBe(rb.pr)
  }, 20000)
})

// -- Test helpers -----------------------------------------------------------

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function forgejoGet<T = any>(baseUrl: string, token: string, path: string): Promise<T> {
  const resp = await fetch(`${baseUrl}${path}`, {
    headers: { 'Authorization': `token ${token}` },
  })
  return resp.json() as Promise<T>
}

/** Submit review on the most recently created open PR (highest number) */
async function submitReview(
  server: ForgejoServer,
  event: string,
  body: string,
  comments?: Array<{ path: string, new_position: number, body: string }>,
) {
  const { url, agentToken } = await server.ensureRunning()
  const prs = await forgejoGet<any[]>(url, agentToken, '/api/v1/repos/agent/workspace/pulls?state=open&sort=newest')
  // Pick highest PR number (most recently created)
  const sorted = prs.sort((a: any, b: any) => b.number - a.number)
  const prNumber = sorted[0]?.number
  if (!prNumber)
    throw new Error('No open PR')
  await submitReviewForPr(server, prNumber, event, body, comments)
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
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`submitReview PR#${prNumber} ${event}: ${resp.status} ${text}`)
  }
}

async function submitReviewForBranch(
  server: ForgejoServer,
  branch: string,
  event: string,
  body: string,
) {
  const { url, agentToken } = await server.ensureRunning()
  const prs = await forgejoGet<any[]>(url, agentToken, `/api/v1/repos/agent/workspace/pulls?state=open&head=agent:${branch}`)
  const prNumber = prs[0]?.number
  if (!prNumber)
    throw new Error(`No open PR for branch ${branch}`)
  await submitReviewForPr(server, prNumber, event, body)
}

async function closeLatestPr(server: ForgejoServer) {
  const { url, agentToken } = await server.ensureRunning()
  const prs = await forgejoGet<any[]>(url, agentToken, '/api/v1/repos/agent/workspace/pulls?state=open')
  const sorted = prs.sort((a: any, b: any) => b.number - a.number)
  const prNumber = sorted[0]?.number
  if (!prNumber)
    throw new Error('No open PR')
  await fetch(`${url}/api/v1/repos/agent/workspace/pulls/${prNumber}`, {
    method: 'PATCH',
    headers: { 'Authorization': `token ${agentToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' }),
  })
}
