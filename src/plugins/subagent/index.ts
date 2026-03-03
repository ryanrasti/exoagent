import { tool } from '../../exoeval/tool'
import type { LanguageModel } from 'ai'
import { generateText, stepCountIs } from 'ai'
import { google } from '@ai-sdk/google'
import { codemode } from '../../code-mode'
import type { DtsCapability } from '../../capabilities'
import { z } from 'zod'

export const SubagentOptionsSchema = z.object({
  /** The task/prompt for the subagent to accomplish */
  prompt: z.string(),
  /** Capabilities to provide to the subagent (should have dts() method). Empty = pure LLM call */
  caps: z.record(z.any()).optional(),
  /** Maximum number of turns before giving up (default: 10) */
  maxTurns: z.number().optional(),
  /** System prompt (optional) */
  system: z.string().optional(),
  /** Whether to log progress (default: false) */
  verbose: z.boolean().optional(),
})
export type SubagentOptions = z.infer<typeof SubagentOptionsSchema>

export interface SubagentResult {
  /** Whether the task was completed successfully */
  success: boolean
  /** The final result/output from the agent */
  result: unknown
  /** Number of turns taken */
  turns: number
  /** Error message if failed */
  error?: string
}

function getModel(): LanguageModel {
  return google('gemini-2.5-flash')
}

export const subagent = tool({
  name: 'subagent',
  description: 'Run a subagent that writes and executes code to accomplish a task. If no caps are provided, this is just an LLM call.',
  input: SubagentOptionsSchema,
  execute: async (options: SubagentOptions): Promise<SubagentResult> => {
    const { prompt, caps, maxTurns = 10, system, verbose = false } = options

    const log = verbose ? console.log.bind(console) : () => {}
    const model = getModel()

    // No caps = pure LLM call
    if (!caps || Object.keys(caps).length === 0) {
      try {
        const response = await generateText({
          model,
          system,
          prompt,
        })
        return {
          success: true,
          result: response.text,
          turns: 1,
        }
      } catch (err) {
        return {
          success: false,
          result: null,
          turns: 1,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }

    // With caps = agentic loop with codemode
    const codemodeToolDef = await codemode(caps)
    log('Codemode description:\n', codemodeToolDef.description.slice(0, 2000))

    try {
      const response = await generateText({
        model,
        system: system ?? SYSTEM_PROMPT,
        prompt: `Task: ${prompt}\n\nUse the codemode tool to write and execute code that accomplishes this task. Return the final result.`,
        tools: {
          codemode: codemodeToolDef,
        },
        stopWhen: stepCountIs(maxTurns),
      })

      log('=== Response ===')
      log('Steps:', response.steps?.length)
      log('Text:', response.text)
      log('Tool calls:', response.toolCalls?.length)
      log('Tool results:', response.toolResults?.length)
      for (const step of response.steps ?? []) {
        log('Step:', step.finishReason, 'text:', step.text ? step.text.slice(0, 100) : '(none)')
        for (const tc of step.toolCalls ?? []) {
          log('  Tool call:', tc.toolName, tc.args ? JSON.stringify(tc.args).slice(0, 500) : '(no args)')
        }
        for (const tr of step.toolResults ?? []) {
          log('  Tool result:', tr ? JSON.stringify(tr).slice(0, 500) : '(none)')
        }
      }

      return {
        success: true,
        result: response.text,
        turns: response.steps?.length ?? 1,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      log('Subagent error:', errorMsg)
      return {
        success: false,
        result: null,
        turns: maxTurns,
        error: errorMsg,
      }
    }
  }
})

export default subagent
