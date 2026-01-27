import type { ChatResult } from './utils'
import { describe, expect, it } from 'vitest'
import { replCore } from './utils'

function mockChatResult(text: string): ChatResult {
  return { text, steps: [] }
}

async function skipToPrompt(repl: AsyncGenerator<string, void, string | undefined>) {
  let result = await repl.next()
  while (!result.done && result.value !== 'You: ') {
    result = await repl.next()
  }
  return result
}

describe('repl', () => {
  it('runs through repl flow', async () => {
    const mockChat = async (prompt: string) => mockChatResult(`Response to: ${prompt}`)

    const repl = replCore({
      title: 'Test REPL',
      context: 'Test context',
      chat: mockChat,
    })

    // Header outputs
    expect((await repl.next()).value).toBe('=== Test REPL ===')
    expect((await repl.next()).value).toBe('Test context')
    expect((await repl.next()).value).toBe('Type your message or "quit" to exit.\n')

    // Prompt
    expect((await repl.next()).value).toBe('You: ')

    // Send input, get response
    expect((await repl.next('hello')).value).toBe('\nAssistant: Response to: hello\n')

    // Next prompt
    expect((await repl.next()).value).toBe('You: ')

    // Exit
    expect((await repl.next('quit')).value).toBe('Goodbye!')
    expect((await repl.next()).done).toBe(true)
  })

  it('handles empty input', async () => {
    const mockChat = async () => mockChatResult('response')
    const repl = replCore({ title: 'Test', context: 'Test', chat: mockChat })
    await skipToPrompt(repl)

    // Empty input should just prompt again
    expect((await repl.next('')).value).toBe('You: ')

    // Whitespace-only should also prompt again
    expect((await repl.next('   ')).value).toBe('You: ')

    // Real input works
    expect((await repl.next('hello')).value).toContain('Assistant:')
  })

  it('handles errors in chat', async () => {
    const mockChat = async () => {
      throw new Error('Test error')
    }
    const repl = replCore({ title: 'Test', context: 'Test', chat: mockChat })
    await skipToPrompt(repl)

    const error = await repl.next('hello')
    expect(error.value).toBe('Error: Test error')
  })

  it('accepts "exit" as well as "quit"', async () => {
    const mockChat = async () => mockChatResult('response')
    const repl = replCore({ title: 'Test', context: 'Test', chat: mockChat })
    await skipToPrompt(repl)

    expect((await repl.next('exit')).value).toBe('Goodbye!')
    expect((await repl.next()).done).toBe(true)
  })
})
