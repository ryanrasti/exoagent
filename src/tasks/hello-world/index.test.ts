import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { transform } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { exoImport } from '../../exoeval'
import { tool } from '../../exoeval/tool'
import { MockGmailClient } from '../../plugins/gmail'

class MockCaps {
  @tool()
  public readonly gmail = new MockGmailClient()

  public logs: string[] = []

  @tool(z.string())
  log(message: string) {
    this.logs.push(message)
  }
}

async function loadTask() {
  const raw = await readFile(join(import.meta.dirname, 'index.ts'), 'utf-8')
  const { code } = await transform(raw, { loader: 'ts' })
  const mod = await exoImport(code)
  return mod.default as (caps: MockCaps) => Promise<void>
}

describe('hello-world task', () => {
  it('lists emails and logs the first one', async () => {
    const caps = new MockCaps()
    const task = await loadTask()
    await task(caps)

    expect(caps.logs).toHaveLength(2)
    expect(caps.logs[0]).toBe('Found 5 emails')
    expect(caps.logs[1]).toContain('Q4 Report Review')
    expect(caps.logs[1]).toContain('boss@company.com')
  })
})
