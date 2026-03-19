import type { AssistantMessage, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from '@mariozechner/pi-ai'
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent'
import type { SandboxCap } from './sandbox'
import { Buffer } from 'node:buffer'
import { execSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {

  createAssistantMessageEventStream,

} from '@mariozechner/pi-ai'
import {

  SessionManager,
  SettingsManager,
} from '@mariozechner/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PiCap } from './pi'

// ---------------------------------------------------------------------------
// Mock LLM provider — returns scripted responses
// ---------------------------------------------------------------------------

type MockResponse = {
  text: string
} | {
  toolCalls: Array<{ name: string, arguments: Record<string, unknown> }>
}

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

/**
 * Creates an extension factory that registers a mock LLM provider.
 * Each call to the LLM pops the next response from the queue.
 */
function createMockProvider(responses: MockResponse[]): {
  factory: ExtensionFactory
  model: Model<any>
} {
  const queue = [...responses]

  const model: Model<any> = {
    provider: 'mock',
    id: 'mock-model',
    name: 'Mock Model',
    api: 'mock-api' as any,
    baseUrl: 'http://localhost:0',
    reasoning: false,
    input: ['text'] as any,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  }

  const factory: ExtensionFactory = (pi) => {
    pi.registerProvider('mock', {
      baseUrl: 'http://localhost:0',
      apiKey: 'mock-key',
      api: 'mock-api' as any,
      models: [{
        id: 'mock-model',
        name: 'Mock Model',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      }],
      streamSimple: (_model: Model<any>, _context: Context, _options?: SimpleStreamOptions): AssistantMessageEventStream => {
        const response = queue.shift()
        if (!response) {
          throw new Error('Mock provider: no more responses in queue')
        }

        const stream = createAssistantMessageEventStream()
        const output: AssistantMessage = {
          role: 'assistant',
          content: [],
          api: 'mock-api' as any,
          provider: 'mock',
          model: 'mock-model',
          usage: { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } },
          stopReason: 'stop',
          timestamp: Date.now(),
        }

        queueMicrotask(() => {
          stream.push({ type: 'start', partial: output })

          if ('text' in response) {
            output.content.push({ type: 'text', text: '' })
            const idx = 0
            stream.push({ type: 'text_start', contentIndex: idx, partial: output })
            const block = output.content[idx] as { type: 'text', text: string }
            block.text = response.text
            stream.push({ type: 'text_delta', contentIndex: idx, delta: response.text, partial: output })
            stream.push({ type: 'text_end', contentIndex: idx, content: response.text, partial: output })
            stream.push({ type: 'done', reason: 'stop', message: output })
            stream.end()
          }
          else {
            output.stopReason = 'toolUse'
            for (let i = 0; i < response.toolCalls.length; i++) {
              const tc = response.toolCalls[i]
              const toolCall = { type: 'toolCall' as const, id: `tc_${i}`, name: tc.name, arguments: tc.arguments }
              output.content.push(toolCall)
              const idx = output.content.length - 1
              const json = JSON.stringify(tc.arguments)
              stream.push({ type: 'toolcall_start', contentIndex: idx, partial: output })
              stream.push({ type: 'toolcall_delta', contentIndex: idx, delta: json, partial: output })
              stream.push({ type: 'toolcall_end', contentIndex: idx, toolCall, partial: output })
            }
            stream.push({ type: 'done', reason: 'toolUse', message: output })
            stream.end()
          }
        })

        return stream
      },
    })
  }

  return { factory, model }
}

// ---------------------------------------------------------------------------
// Fake sandbox for testing (no bwrap needed)
// ---------------------------------------------------------------------------

function createFakeSandbox(workspace: string): SandboxCap {
  return {
    workspace,
    async exec({ command, stdin }: { command: string, stdin?: string }) {
      try {
        const stdout = execSync(command, { cwd: workspace, encoding: 'utf-8', timeout: 5000, input: stdin })
        return { stdout, stderr: '', exitCode: 0 }
      }
      catch (err: any) {
        return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', exitCode: err.status ?? 1 }
      }
    },
  } as unknown as SandboxCap
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PiCap', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pi-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns text from mock LLM', async () => {
    const { factory, model } = createMockProvider([
      { text: 'Hello from mock!' },
    ])

    const pi = new PiCap({
      sandbox: createFakeSandbox(tmpDir),
      model,
      capsDts: '',
      extensionFactories: [factory],
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
    })

    const result = await pi.prompt('Say hello')
    pi.dispose()

    expect(result).toBe('Hello from mock!')
  })

  it('executes bash tool calls', async () => {
    await writeFile(join(tmpDir, 'hello.txt'), 'world')

    const { factory, model } = createMockProvider([
      { toolCalls: [{ name: 'bash', arguments: { command: 'cat hello.txt' } }] },
      { text: 'The file contains: world' },
    ])

    const pi = new PiCap({
      sandbox: createFakeSandbox(tmpDir),
      model,
      capsDts: '',
      extensionFactories: [factory],
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
    })

    const result = await pi.prompt('Read hello.txt')
    pi.dispose()

    expect(result).toBe('The file contains: world')
  })

  it('executes read tool calls', async () => {
    await writeFile(join(tmpDir, 'test.txt'), 'file content here')

    const { factory, model } = createMockProvider([
      { toolCalls: [{ name: 'read', arguments: { path: join(tmpDir, 'test.txt') } }] },
      { text: 'Got it.' },
    ])

    const pi = new PiCap({
      sandbox: createFakeSandbox(tmpDir),
      model,
      capsDts: '',
      extensionFactories: [factory],
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
    })

    const result = await pi.prompt('Read the file')
    pi.dispose()

    expect(result).toBe('Got it.')
  })

  it('executes write tool calls', async () => {
    const filePath = join(tmpDir, 'output.txt')

    const { factory, model } = createMockProvider([
      { toolCalls: [{ name: 'write', arguments: { path: filePath, content: 'written by mock' } }] },
      { text: 'File written.' },
    ])

    const pi = new PiCap({
      sandbox: createFakeSandbox(tmpDir),
      model,
      capsDts: '',
      extensionFactories: [factory],
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
    })

    const result = await pi.prompt('Write a file')
    pi.dispose()

    expect(result).toBe('File written.')
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('written by mock')
  })
})

// ---------------------------------------------------------------------------
// Sandbox file ops (sandboxRead, sandboxWrite, sandboxAccess, mkdir)
// These test the actual methods that pi's tools delegate to.
// ---------------------------------------------------------------------------

describe('sandbox file ops', () => {
  let tmpDir: string
  let pi: PiCap

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pi-fileops-'))
    const { factory, model } = createMockProvider([{ text: 'ok' }])
    pi = new PiCap({
      sandbox: createFakeSandbox(tmpDir),
      model,
      capsDts: '',
      extensionFactories: [factory],
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
    })
  })

  afterEach(async () => {
    pi.dispose()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('read returns file content', async () => {
    await writeFile(join(tmpDir, 'test.txt'), 'hello world')
    const ops = (pi as any).scopedReadOps()
    const buf = await ops.readFile(join(tmpDir, 'test.txt'))
    expect(buf.toString()).toBe('hello world')
  })

  it('read handles binary content', async () => {
    const binary = Buffer.from([0x00, 0x01, 0xFF, 0xFE, 0x0A, 0x0D])
    await writeFile(join(tmpDir, 'bin.dat'), binary)
    const ops = (pi as any).scopedReadOps()
    const buf = await ops.readFile(join(tmpDir, 'bin.dat'))
    expect(Buffer.compare(buf, binary)).toBe(0)
  })

  it('write creates file with content', async () => {
    const ops = (pi as any).scopedWriteOps()
    await ops.writeFile(join(tmpDir, 'out.txt'), 'written content')
    const content = await readFile(join(tmpDir, 'out.txt'), 'utf-8')
    expect(content).toBe('written content')
  })

  it('write handles special characters', async () => {
    const ops = (pi as any).scopedWriteOps()
    const special = 'hello $HOME `whoami` $(id) \'single\' "double" \\backslash\nnewline'
    await ops.writeFile(join(tmpDir, 'special.txt'), special)
    const content = await readFile(join(tmpDir, 'special.txt'), 'utf-8')
    expect(content).toBe(special)
  })

  it('mkdir creates nested directories', async () => {
    const ops = (pi as any).scopedWriteOps()
    await ops.mkdir(join(tmpDir, 'a', 'b', 'c'))
    const result = execSync(`test -d ${join(tmpDir, 'a', 'b', 'c')} && echo ok`, { encoding: 'utf-8' })
    expect(result.trim()).toBe('ok')
  })

  it('access succeeds for existing file', async () => {
    await writeFile(join(tmpDir, 'exists.txt'), 'yes')
    const ops = (pi as any).scopedReadOps()
    await expect(ops.access(join(tmpDir, 'exists.txt'))).resolves.toBeUndefined()
  })

  it('access throws for missing file', async () => {
    const ops = (pi as any).scopedReadOps()
    await expect(ops.access(join(tmpDir, 'nope.txt'))).rejects.toThrow()
  })

  it('handles paths with single quotes', async () => {
    const ops = (pi as any).scopedWriteOps()
    const dir = join(tmpDir, 'it\'s')
    await ops.mkdir(dir)
    const readOps = (pi as any).scopedReadOps()
    const writeOps = (pi as any).scopedWriteOps()
    await writeOps.writeFile(join(dir, 'file.txt'), 'quoted')
    const buf = await readOps.readFile(join(dir, 'file.txt'))
    expect(buf.toString()).toBe('quoted')
  })

  it('handles paths with dollar signs and backticks', async () => {
    const ops = (pi as any).scopedWriteOps()
    const file = join(tmpDir, '$HOME`whoami`file.txt')
    await ops.writeFile(file, 'safe')
    const readOps = (pi as any).scopedReadOps()
    const buf = await readOps.readFile(file)
    expect(buf.toString()).toBe('safe')
  })
})
