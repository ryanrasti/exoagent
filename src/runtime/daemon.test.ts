import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Daemon } from './daemon'
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

describe('Daemon', () => {
  let daemon: Daemon
  let repoDir: string
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'daemon-test-'))
    repoDir = join(root, 'repo')

    execFileSync(GIT, ['init', repoDir])
    execFileSync(GIT, ['checkout', '-b', 'main'], { cwd: repoDir })
    await writeFile(join(repoDir, 'README.md'), '# Test\n')
    execFileSync(GIT, ['add', '.'], { cwd: repoDir })
    execFileSync(GIT, ['-c', 'user.name=test', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: repoDir })

    ForgejoServer.reset()
    daemon = await Daemon.start({ repoDir })
  }, 30000)

  afterAll(async () => {
    await daemon.stop()
    ForgejoServer.reset()
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  })

  it('exposes shared caps', () => {
    expect(daemon.storage).toBeDefined()
    expect(daemon.secrets).toBeDefined()
    expect(daemon.forgejo).toBeDefined()
  })

  it('starts with no agents', () => {
    expect(daemon.list()).toEqual([])
  })

  it('spawns an agent via dtach', async () => {
    const id = await daemon.spawn('test-agent')
    expect(id).toBe('test-agent')
    expect(daemon.list()).toContain('test-agent')
  }, 15000)

  it('rejects duplicate agent ids', async () => {
    await expect(daemon.spawn('test-agent')).rejects.toThrow('already running')
  })

  it('kills an agent', () => {
    daemon.kill('test-agent')
    expect(daemon.list()).not.toContain('test-agent')
  })

  it('forgejo starts lazily', async () => {
    const { url } = await daemon.forgejo.ensureRunning()
    const resp = await fetch(`${url}/api/v1/version`)
    expect(resp.ok).toBe(true)
  }, 30000)
})
