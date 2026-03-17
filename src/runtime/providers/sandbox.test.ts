import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nixPathsFromEnv, SandboxCap } from './sandbox'
import { StorageCap } from './storage'

const NIX = nixPathsFromEnv()

const testRoot = join(tmpdir(), `exoagent-sandbox-test-${process.pid}`)
const workspaceDir = join(testRoot, 'workspace')

describe('SandboxCap', () => {
  let storage: StorageCap
  let sandbox: SandboxCap

  beforeEach(async () => {
    await mkdir(workspaceDir, { recursive: true })
    storage = new StorageCap(testRoot)
    sandbox = new SandboxCap({
      nix: NIX,
      storage,
      sessionId: 'test-session',
      workspace: workspaceDir,
    })
  })

  afterEach(async () => {
    storage.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  describe('exec', () => {
    it('runs a command and captures stdout', async () => {
      const result = await sandbox.exec({ command: 'echo hello' })
      expect(result.stdout.trim()).toBe('hello')
      expect(result.exitCode).toBe(0)
    })

    it('captures stderr', async () => {
      const result = await sandbox.exec({ command: 'echo error >&2' })
      expect(result.stderr).toContain('error')
    })

    it('returns non-zero exit code', async () => {
      const result = await sandbox.exec({ command: 'exit 42' })
      expect(result.exitCode).toBe(42)
    })

    it('has PID isolation', async () => {
      const result = await sandbox.exec({ command: 'ls /proc | grep -E "^[0-9]+$" | wc -l' })
      expect(result.exitCode).toBe(0)
      const pidCount = Number.parseInt(result.stdout.trim())
      expect(pidCount).toBeLessThan(10)
    })

    it('can access /nix/store', async () => {
      const result = await sandbox.exec({ command: 'ls /nix/store | head -1' })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim().length).toBeGreaterThan(0)
    })

    it('workspace is mounted at its host path', async () => {
      await writeFile(join(workspaceDir, 'test.txt'), 'from host')
      const result = await sandbox.exec({ command: `cat ${workspaceDir}/test.txt` })
      expect(result.stdout.trim()).toBe('from host')
    })

    it('cwd is the workspace path', async () => {
      const result = await sandbox.exec({ command: 'pwd' })
      expect(result.stdout.trim()).toBe(workspaceDir)
    })

    it('blocks loopback access', async () => {
      // Start a real server on localhost
      const { createServer } = await import('node:http')
      const server = createServer((_req, res) => { res.end('hello') })
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as any).port

      try {
        // Verify host can connect using the same bash command
        const { execSync } = await import('node:child_process')
        const hostResult = execSync(`timeout 2 bash -c "echo x > /dev/tcp/127.0.0.1/${port}" 2>&1 && echo connected || echo blocked`).toString()
        expect(hostResult).toContain('connected')

        // Sandbox should NOT be able to connect (nft drops 127.0.0.0/8)
        const result = await sandbox.exec({
          command: `timeout 2 bash -c "echo x > /dev/tcp/127.0.0.1/${port}" 2>&1 && echo connected || echo blocked`,
          timeout: 10000,
        })
        expect(result.stdout).toContain('blocked')
        expect(result.stdout).not.toContain('connected')
      }
      finally {
        server.close()
      }
    }, 15000)

    it('timeout kills long-running commands', async () => {
      await expect(sandbox.exec({ command: 'sleep 60', timeout: 500 })).rejects.toThrow('timed out')
    })
  })

  describe('validatePath', () => {
    it('resolves relative paths to workspace', () => {
      expect(sandbox.validatePath('hello.txt')).toBe(join(workspaceDir, 'hello.txt'))
    })

    it('rejects path traversal', () => {
      expect(() => sandbox.validatePath('../escape')).toThrow('escapes workspace')
    })

    it('rejects absolute paths outside workspace', () => {
      expect(() => sandbox.validatePath('/etc/passwd')).toThrow('escapes workspace')
    })
  })

  describe('nix', () => {
    it('nix is available and can run', async () => {
      const result = await sandbox.exec({ command: 'nix --version' })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('nix (Nix)')
    })

    it('host closure paths are readable, /nix/store is writable for new packages', async () => {
      const read = await sandbox.exec({ command: 'ls /nix/store | head -1' })
      expect(read.exitCode).toBe(0)
      expect(read.stdout.trim().length).toBeGreaterThan(0)
      const write = await sandbox.exec({ command: 'touch /nix/store/test-write && echo ok' })
      expect(write.stdout.trim()).toBe('ok')
    })

    it('has working DNS', async () => {
      const result = await sandbox.exec({ command: 'cat /etc/resolv.conf' })
      expect(result.stdout).toContain('1.1.1.1')
    })

    it('has SSL certificates', async () => {
      const result = await sandbox.exec({ command: 'echo $NIX_SSL_CERT_FILE' })
      expect(result.stdout.trim()).toContain('ca-bundle.crt')
    })

    it('can build and run a trivial derivation', async () => {
      const bashPath = NIX.bash
      const result = await sandbox.exec({
        command: `set -euo pipefail; OUT=$(nix build --no-link --print-out-paths --impure --expr '
          derivation {
            name = "hello-test";
            system = builtins.currentSystem;
            builder = "${bashPath}/bin/bash";
            args = ["-c" "echo hello-from-nix > $out"];
          }
        ' 2>/dev/null); cat "$OUT"`,
        timeout: 30000,
      })
      if (!result.stdout.includes('hello-from-nix')) {
        console.log('stdout:', result.stdout)
        console.log('stderr:', result.stderr)
        console.log('exitCode:', result.exitCode)
      }
      expect(result.stdout).toContain('hello-from-nix')
    }, 60000)
  })
})
