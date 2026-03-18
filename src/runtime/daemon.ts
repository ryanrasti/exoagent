import { execFileSync, spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { StorageCap } from './providers/storage'
import { Secrets } from './providers/secrets'
import { ArgsCap } from './providers/args'
import { SpawnCap } from './providers/spawn-cap'
import { AttachCap } from './providers/attach-cap'
import { loadExo } from './exo'

/**
 * exoagentd — runtime daemon.
 *
 * Owns shared infrastructure (storage, secrets) and manages
 * agent processes via dtach (terminal session manager).
 */

export interface DaemonConfig {
  repoDir: string
  dataDir?: string
}

export class Daemon {
  readonly repoDir: string
  readonly dataDir: string
  readonly storage: StorageCap
  readonly secrets: Secrets

  private constructor(
    repoDir: string,
    dataDir: string,
    storage: StorageCap,
    secrets: Secrets,
  ) {
    this.repoDir = repoDir
    this.dataDir = dataDir
    this.storage = storage
    this.secrets = secrets
  }

  static async start(config: DaemonConfig): Promise<Daemon> {
    const repoDir = config.repoDir
    const dataDir = config.dataDir ?? join(repoDir, '.exoagent')

    await mkdir(dataDir, { recursive: true })

    const storage = new StorageCap(join(dataDir, 'storage.db'))
    const secrets = new Secrets(join(dataDir, 'secrets.db'))

    return new Daemon(repoDir, dataDir, storage, secrets)
  }

  /** Spawn an agent in a dtach session */
  async spawn(agentId: string): Promise<string> {
    const agentsDir = join(this.dataDir, 'agents')
    await mkdir(agentsDir, { recursive: true })

    const sockPath = join(agentsDir, `${agentId}.sock`)
    if (existsSync(sockPath))
      throw new Error(`Agent "${agentId}" already running (socket exists: ${sockPath})`)

    const dtach = join(process.env.EXOAGENT_NIX_DTACH!, 'bin', 'dtach')
    const agentScript = join(import.meta.dirname!, 'start-agent.ts')

    const proc = spawn(dtach, ['-n', sockPath, 'npx', 'tsx', agentScript], {
      cwd: this.repoDir,
      stdio: 'ignore',
      detached: true,
      env: {
        ...process.env,
        EXOAGENT_REPO_DIR: this.repoDir,
        EXOAGENT_DATA_DIR: this.dataDir,
        EXOAGENT_AGENT_ID: agentId,
      },
    })
    proc.unref()

    const pidPath = join(agentsDir, `${agentId}.pid`)
    writeFileSync(pidPath, String(proc.pid))

    // Wait for socket to appear
    for (let i = 0; i < 50; i++) {
      if (existsSync(sockPath))
        return agentId
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error(`Agent "${agentId}" failed to start (socket not created)`)
  }

  /** Attach to an agent — replaces current process with dtach */
  attach(agentId: string): void {
    const sockPath = join(this.dataDir, 'agents', `${agentId}.sock`)
    if (!existsSync(sockPath))
      throw new Error(`Agent "${agentId}" not found (no socket at ${sockPath})`)

    const dtach = join(process.env.EXOAGENT_NIX_DTACH!, 'bin', 'dtach')
    execFileSync(dtach, ['-a', sockPath], { stdio: 'inherit' })
  }

  /** List running agents (by socket files) */
  list(): string[] {
    const agentsDir = join(this.dataDir, 'agents')
    if (!existsSync(agentsDir))
      return []
    return readdirSync(agentsDir)
      .filter(f => f.endsWith('.sock'))
      .map(f => f.replace('.sock', ''))
  }

  /** Kill an agent — terminates the dtach process tree */
  kill(agentId: string): void {
    const agentsDir = join(this.dataDir, 'agents')
    const pidPath = join(agentsDir, `${agentId}.pid`)
    const sockPath = join(agentsDir, `${agentId}.sock`)

    try {
      const pid = parseInt(readFileSync(pidPath, 'utf-8').trim())
      if (pid)
        process.kill(-pid, 'SIGTERM')
    }
    catch {}

    try { unlinkSync(pidPath) } catch {}
    try { unlinkSync(sockPath) } catch {}
  }

  /** Run an exo with daemon caps */
  async runExo(name: string, exoArgs: string[] = []): Promise<unknown> {
    const exoPath = join(import.meta.dirname!, 'exos', `${name}.ts`)
    const source = readFileSync(exoPath, 'utf-8')

    const { transformSync } = await import('esbuild')
    const { code: stripped } = transformSync(source, { loader: 'ts', format: 'esm' })
    const code = stripped
      .replace(/^var (\w+) = /, 'export default ')
      .replace(/\nexport \{[\s\S]*\};\s*$/, '\n')

    const exo = await loadExo(name, code)

    const caps = {
      spawn: new SpawnCap((id: string) => this.spawn(id)),
      args: new ArgsCap(exoArgs),
      attach: new AttachCap((id: string) => this.attach(id)),
      storage: this.storage,
    }

    return exo.run(caps)
  }

  async stop(): Promise<void> {
    for (const id of this.list())
      this.kill(id)
  }
}
