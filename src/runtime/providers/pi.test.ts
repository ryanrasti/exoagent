import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PiCap } from './pi'
import type { SandboxCap } from './sandbox'
import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type AssistantMessageEventStream,
} from '@mariozechner/pi-ai'
import {
  type ExtensionFactory,
  SessionManager,
  SettingsManager,
} from '@mariozechner/pi-coding-agent'

// ---------------------------------------------------------------------------
// Mock LLM provider — returns scripted responses
// ---------------------------------------------------------------------------

type MockResponse = {
  text: string
} | {
  toolCalls: Array<{ name: string, arguments: Record<string, unknown> }>
}

const ZERO_USAGE = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
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
    validatePath(p: string) {
      if (!p.startsWith(workspace)) {
        throw new Error(`Path ${p} outside workspace ${workspace}`)
      }
    },
    async exec({ command }: { command: string }) {
      try {
        const stdout = execSync(command, { cwd: workspace, encoding: 'utf-8', timeout: 5000 })
        return { stdout, stderr: '', exitCode: 0 }
      }
      catch (err: any) {
        return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', exitCode: err.status ?? 1 }
      }
    },
  } as SandboxCap
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
