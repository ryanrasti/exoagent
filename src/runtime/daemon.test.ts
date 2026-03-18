import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Daemon } from './daemon'
import { spawnAgent } from './spawn'
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

describe('Daemon + spawnAgent', () => {
  let daemon: Daemon
  let repoDir: string
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'daemon-test-'))
    repoDir = join(root, 'repo')

    execFileSync(GIT, ['init', repoDir])
    execFileSync(GIT, ['checkout', '-b', 'main'], { cwd: repoDir })
    await writeFile(join(repoDir, 'README.md'), '# Test Project\n')
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

  it('daemon exposes shared caps', () => {
    expect(daemon.storage).toBeDefined()
    expect(daemon.secrets).toBeDefined()
    expect(daemon.forgejo).toBeDefined()
  })

  it('spawnAgent creates a clone with repo contents', async () => {
    const agent = await spawnAgent({
      id: 'test-agent',
      repoDir,
      dataDir: daemon.dataDir,
      storage: daemon.storage,
      forgejo: daemon.forgejo,
    })

    expect(agent.id).toBe('test-agent')
    expect(agent.pi).toBeDefined()
    expect(agent.review).toBeDefined()

    const readme = await readFile(join(agent.cloneDir, 'README.md'), 'utf-8')
    expect(readme).toBe('# Test Project\n')

    agent.pi.dispose()
  })

  it('spawns multiple agents independently', async () => {
    const a1 = await spawnAgent({
      id: 'agent-1',
      repoDir,
      dataDir: daemon.dataDir,
      storage: daemon.storage,
      forgejo: daemon.forgejo,
    })
    const a2 = await spawnAgent({
      id: 'agent-2',
      repoDir,
      dataDir: daemon.dataDir,
      storage: daemon.storage,
      forgejo: daemon.forgejo,
    })

    expect(a1.cloneDir).not.toBe(a2.cloneDir)
    expect(a1.id).not.toBe(a2.id)

    a1.pi.dispose()
    a2.pi.dispose()
  })

  it('forgejo starts lazily', async () => {
    const { url } = await daemon.forgejo.ensureRunning()
    const resp = await fetch(`${url}/api/v1/version`)
    expect(resp.ok).toBe(true)
  }, 30000)
})
