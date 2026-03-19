import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Daemon } from './daemon'
import { spawnAgent, type Agent } from './providers/pi'

const GIT = join(JSON.parse(process.env.EXOAGENT_NIX!).git, 'bin', 'git')

describe('e2e: spawnAgent', () => {
  let daemon: Daemon
  let agent: Agent
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'e2e-test-'))
    const repoDir = join(root, 'repo')

    execFileSync(GIT, ['init', repoDir])
    execFileSync(GIT, ['checkout', '-b', 'main'], { cwd: repoDir })
    await writeFile(join(repoDir, 'README.md'), '# Test Project\n')
    execFileSync(GIT, ['add', '.'], { cwd: repoDir })
    execFileSync(GIT, ['-c', 'user.name=test', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: repoDir })

    // Create a bare repo as a fake "remote" for clone --reference
    const bareDir = join(root, 'bare.git')
    execFileSync(GIT, ['clone', '--bare', repoDir, bareDir])
    execFileSync(GIT, ['-C', repoDir, 'remote', 'add', 'origin', bareDir])

    daemon = await Daemon.start({ repoDir })
    agent = await spawnAgent({
      id: 'e2e-test',
      repoDir,
      dataDir: daemon.dataDir,
      storage: daemon.storage,
      secrets: daemon.secrets,
    })
  }, 30000)

  afterAll(async () => {
    agent.pi.dispose()
    await daemon.stop()
    await rm(root, { recursive: true, force: true })
  })

  it('agent has pi, review, and clone', () => {
    expect(agent.pi).toBeDefined()
    // review is undefined for non-GitHub repos (test uses local bare repo)
    expect(agent.review).toBeUndefined()
    expect(agent.cloneDir).toContain('e2e-test')
  })

  it('clone has repo contents', async () => {
    const readme = await readFile(join(agent.cloneDir, 'README.md'), 'utf-8')
    expect(readme).toBe('# Test Project\n')
  })

  // GitHub PR tests require GITHUB_TOKEN and a real repo — skip in CI
  it.skip('full flow: edit → commit → openPR → review → getReviews', async () => {
    // To run: GITHUB_TOKEN=xxx npx vitest --run src/runtime/e2e.test.ts
  })
})
