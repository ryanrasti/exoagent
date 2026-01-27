import type { ChatResult } from './utils'
import { MockLanguageModelV3 } from 'ai/test'

export function createMockModel(toolCalls: Array<{ code: string }>) {
  let callIndex = 0
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const usage = {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      }
      if (callIndex < toolCalls.length) {
        const { code } = toolCalls[callIndex++]
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: `call-${callIndex}`,
              toolName: 'execute',
              input: JSON.stringify({ code }),
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage,
          warnings: [],
        }
      }
      return {
        content: [{ type: 'text' as const, text: 'Done!' }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage,
        warnings: [],
      }
    },
  })
}

export function getToolResults(result: ChatResult): unknown[] {
  return result.steps.flatMap(step =>
    (step.toolResults || []).map(tr => tr.output),
  )
}
