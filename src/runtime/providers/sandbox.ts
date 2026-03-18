import type { StorageCap } from './storage'
/* eslint-disable node/prefer-global/buffer, node/prefer-global/process */
import { execFileSync, spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import z from 'zod'
import { tool } from '../../exoeval/tool'

/**
 * Sandbox provider — bwrap-based execution environment with network
 * isolation (internet yes, LAN/loopback blocked via pasta + nft).
 *
 * - exec: runs commands inside bwrap (PID-isolated, net-filtered, fs-scoped)
 * - read/write/edit: host-side file ops, path-validated to workspace
 */

/** Nix store paths for essential binaries */
export interface NixPaths {
  bash: string
  coreutils: string
  bwrap: string
  pasta: string
  nft: string
  nix: string
  cacert: string
  git: string
  gnugrep: string
}

/** Read nix paths from EXOAGENT_NIX_* env vars set by flake.nix devShell */
export function nixPathsFromEnv(): NixPaths {
  const get = (name: string): string => {
    const val = process.env[`EXOAGENT_NIX_${name.toUpperCase()}`]
    if (!val) {
      throw new Error(`Missing env var EXOAGENT_NIX_${name.toUpperCase()} — are you in the devShell?`)
    }
    return val
  }
  return {
    bash: get('bash'),
    coreutils: get('coreutils'),
    bwrap: get('bwrap'),
    pasta: get('pasta'),
    nft: get('nft'),
    nix: get('nix'),
    cacert: get('cacert'),
    git: get('git'),
    gnugrep: get('gnugrep'),
  }
}

interface SandboxConfig {
  nix: NixPaths
  storage: StorageCap
  sessionId: string
  workspace: string
}

export class SandboxCap {
  private config: SandboxConfig
  private rootDir: string | null = null
  private scriptWritten = false

  constructor(config: SandboxConfig) {
    this.config = config
  }

  private async getRoot(): Promise<string> {
    if (this.rootDir) {
      return this.rootDir
    }
    this.rootDir = await this.config.storage.dir(`sandbox/${this.config.sessionId}`)
    return this.rootDir
  }

  /** Compute the transitive closure of nix store paths needed in the sandbox */
  private nixClosure(): string[] {
    const { nix } = this.config
    const roots = [nix.bash, nix.coreutils, nix.nix, nix.cacert, nix.git, nix.gnugrep]
    const output = execFileSync('nix-store', ['-qR', ...roots], { encoding: 'utf-8' })
    return output.trim().split('\n').filter(Boolean).sort()
  }

  /** Validate a path is safe to interpolate into a shell script (no special chars) */
  private static assertSafePath(p: string, label: string): void {
    if (!/^[a-zA-Z0-9/_+.-]+$/.test(p)) {
      throw new Error(`Unsafe ${label} path for shell interpolation: ${p}`)
    }
  }

  /** Write the wrapper script once, reuse for every exec */
  private async ensureScript(): Promise<string> {
    const root = await this.getRoot()
    const scriptPath = join(root, 'sandbox.sh')
    if (this.scriptWritten) {
      return scriptPath
    }

    const { nix } = this.config
    const ws = this.config.workspace

    // Validate all paths interpolated into the shell script
    SandboxCap.assertSafePath(root, 'session root')
    SandboxCap.assertSafePath(ws, 'workspace')
    for (const [k, v] of Object.entries(nix)) {
      SandboxCap.assertSafePath(v, `nix.${k}`)
    }

    // Compute closure of all nix packages needed in sandbox
    const closure = this.nixClosure()
    for (const p of closure) {
      SandboxCap.assertSafePath(p, 'nix closure')
    }
    const closureBinds = closure.map(p => `  --ro-bind ${p} ${p} \\`).join('\n')

    // Create parent directories for the workspace bind mount
    // (bwrap won't create intermediate dirs — e.g. /home/ryan/src needs to exist for /home/ryan/src/proj)
    const wsDirs: string[] = []
    let dir = ws
    while (dir !== '/' && dir !== '.') {
      dir = resolve(dir, '..')
      if (dir !== '/') {
        wsDirs.unshift(dir)
      }
    }
    const wsDirEntries = wsDirs.map(d => `  --dir ${d} \\`).join('\n')

    const script = `#!${nix.bash}/bin/bash
set -euo pipefail

# Block LAN/loopback via nft
${nix.nft}/bin/nft add table ip filter
${nix.nft}/bin/nft add chain ip filter output '{ type filter hook output priority 0 ; }'
${nix.nft}/bin/nft add rule ip filter output ip daddr 127.0.0.0/8 drop
${nix.nft}/bin/nft add rule ip filter output ip daddr 10.0.0.0/8 drop
${nix.nft}/bin/nft add rule ip filter output ip daddr 172.16.0.0/12 drop
${nix.nft}/bin/nft add rule ip filter output ip daddr 192.168.0.0/16 drop
${nix.nft}/bin/nft add rule ip filter output ip daddr 169.254.0.0/16 drop
${nix.nft}/bin/nft add table ip6 filter
${nix.nft}/bin/nft add chain ip6 filter output '{ type filter hook output priority 0 ; }'
${nix.nft}/bin/nft add rule ip6 filter output ip6 daddr ::1 drop
${nix.nft}/bin/nft add rule ip6 filter output ip6 daddr fe80::/10 drop
${nix.nft}/bin/nft add rule ip6 filter output ip6 daddr fc00::/7 drop
${nix.nft}/bin/nft add rule ip6 filter output ip6 daddr fd00::/8 drop

# Write a resolv.conf with public DNS
mkdir -p ${root}/etc
echo 'nameserver 1.1.1.1' > ${root}/etc/resolv.conf
echo 'nameserver 8.8.8.8' >> ${root}/etc/resolv.conf

# Set up persistent dirs in session storage
mkdir -p ${root}/nix ${root}/home/agent

# Run command inside bwrap
# /nix is bind-mounted from session storage — persists across exec calls
# Host closure paths are ro-bound on top so existing packages are available
exec ${nix.bwrap}/bin/bwrap \\
  --die-with-parent \\
  --unshare-pid \\
  --bind ${root}/nix /nix \\
${closureBinds}
  --symlink ${nix.bash}/bin/bash /bin/bash \\
  --symlink ${nix.bash}/bin/bash /bin/sh \\
  --symlink ${nix.coreutils}/bin/env /usr/bin/env \\
  --ro-bind ${root}/etc/resolv.conf /etc/resolv.conf \\
  --bind ${root}/home /home \\
  --tmpfs /tmp \\
${wsDirEntries}
  --bind ${ws} ${ws} \\
  --proc /proc \\
  --dev /dev \\
  --setenv HOME /home/agent \\
  --setenv PATH ${nix.gnugrep}/bin:${nix.git}/bin:${nix.nix}/bin:${nix.coreutils}/bin:${nix.bash}/bin:/home/agent/.nix-profile/bin \\
  --setenv NIX_SSL_CERT_FILE ${nix.cacert}/etc/ssl/certs/ca-bundle.crt \\
  --setenv NIX_CONFIG 'experimental-features = nix-command flakes
build-users-group =
require-drop-supplementary-groups = false
sandbox = false' \\
  --chdir ${ws} \\
  -- /bin/bash -c "$1"
`
    await writeFile(scriptPath, script, { mode: 0o755 })
    this.scriptWritten = true
    return scriptPath
  }

  /** Resolve a path relative to workspace, reject escapes */
  private resolvePath(path: string): string {
    const ws = this.config.workspace
    const resolved = resolve(ws, path)
    if (!resolved.startsWith(`${ws}/`) && resolved !== ws) {
      throw new Error(`Path escapes workspace: ${path}`)
    }
    return resolved
  }

  @tool(z.object({
    command: z.string(),
    timeout: z.number().optional(),
  }))
  async exec({ command, timeout, env, signal }: { command: string, timeout?: number, env?: Record<string, string>, signal?: AbortSignal }): Promise<{ stdout: string, stderr: string, exitCode: number }> {
    const { nix } = this.config
    const scriptPath = await this.ensureScript()

    return new Promise((resolve, reject) => {
      const proc = spawn(
        `${nix.pasta}/bin/pasta`,
        ['--quiet', '--config-net', '--', `${nix.bash}/bin/bash`, scriptPath, command],
        { stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : undefined },
      )

      let stdout = ''
      let stderr = ''
      let timer: ReturnType<typeof setTimeout> | undefined

      proc.stdout!.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr!.on('data', (d: Buffer) => { stderr += d.toString() })

      if (timeout) {
        timer = setTimeout(() => {
          proc.kill('SIGKILL')
          reject(new Error(`Command timed out after ${timeout}ms`))
        }, timeout)
      }

      if (signal) {
        const onAbort = () => {
          proc.kill('SIGKILL')
          reject(new Error('Command aborted'))
        }
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
        proc.on('close', () => signal.removeEventListener('abort', onAbort))
      }

      proc.on('close', (code) => {
        if (timer) {
          clearTimeout(timer)
        }
        resolve({ stdout, stderr, exitCode: code ?? 1 })
      })

      proc.on('error', (err) => {
        if (timer) {
          clearTimeout(timer)
        }
        reject(err)
      })
    })
  }

  /** Validate and resolve a path, ensuring it stays in workspace */
  validatePath(path: string): string {
    return this.resolvePath(path)
  }

  get workspace(): string {
    return this.config.workspace
  }
}
