import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Daemon } from './daemon'
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

describe('Daemon', () => {
  let daemon: Daemon
  let repoDir: string
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'daemon-test-'))
    repoDir = join(root, 'repo')

    // Init main repo
    execFileSync(GIT, ['init', repoDir])
    execFileSync(GIT, ['checkout', '-b', 'main'], { cwd: repoDir })
    await writeFile(join(repoDir, 'README.md'), '# Test Project\n')
    execFileSync(GIT, ['add', '.'], { cwd: repoDir })
    execFileSync(GIT, ['-c', 'user.name=test', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: repoDir })

    daemon = await Daemon.start({ repoDir, agentId: 'test-agent' })
  }, 30000)

  afterAll(async () => {
    await daemon.stop()
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  it('creates a working clone with the repo contents', async () => {
    // The clone should have the README from main
    const cloneDir = join(repoDir, '.exoagent', 'clones', 'test-agent')
    const readme = await readFile(join(cloneDir, 'README.md'), 'utf-8')
    expect(readme).toBe('# Test Project\n')
  })

  it('pi is available', () => {
    expect(daemon.pi).toBeDefined()
  })

  it('review is available', () => {
    expect(daemon.review).toBeDefined()
  })

  it('forgejo is running with review URL', async () => {
    const url = await daemon.reviewUrl
    expect(url).toMatch(/localhost:\d+.*pulls/)
  }, 30000)
})
