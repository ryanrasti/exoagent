import type { LanguageModel } from 'ai'
import { generateText, stepCountIs } from 'ai'
import { google } from '@ai-sdk/google'
import { codemode } from '../../code-mode'
import type { DtsCapability } from '../../capabilities'

export interface SubagentOptions {
  /** The task/prompt for the subagent to accomplish */
  prompt: string
  /** Capabilities to provide to the subagent (should have dts() method). Empty = pure LLM call */
  caps?: Record<string, object>
  /** Maximum number of turns before giving up (default: 10) */
  maxTurns?: number
  /** System prompt (optional) */
  system?: string
  /** Whether to log progress (default: false) */
  verbose?: boolean
}

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

/**
 * Build the combined .d.ts from all caps that have dts() method
 */
async function buildDts(caps: Record<string, object>): Promise<string> {
  const parts: string[] = []

  for (const [name, cap] of Object.entries(caps)) {
    if (cap && typeof cap === 'object' && 'dts' in cap && typeof (cap as DtsCapability).dts === 'function') {
      const capDts = await (cap as DtsCapability).dts()
      parts.push(`// <${name}>\n${capDts}`)
    }
  }

  // Add the Api type
  const capNames = Object.keys(caps)
    .map((k) => `${k}: typeof import('./${k}')`)
    .join('; ')
  parts.push(`\n// <api>\nexport interface Api { ${capNames} }`)
  parts.push(`export default async function(api: Api): Promise<unknown>`)

  return parts.join('\n\n')
}

const SYSTEM_PROMPT = `You are a code-writing agent. You accomplish tasks by writing JavaScript code that uses the provided API.

IMPORTANT RULES:
1. You MUST call the codemode tool to execute code - never output code directly
2. Write async functions that use the provided api object
3. Return meaningful results from your code
4. If something fails, try a different approach
5. When done, return a final result with all requested information

The api object contains capabilities you can use. Study the type definitions carefully.

When working with a browser:
- Always call snapshot() first to see the page
- Use clickRole(role, name) for buttons/links
- Use fillByLabel(label, text) for form fields
- The browser may be restricted to certain domains`

/**
 * Run a subagent that writes and executes code to accomplish a task.
 * If no caps are provided, this is just an LLM call.
 */
export async function runSubagent(options: SubagentOptions): Promise<SubagentResult> {
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
  const dts = await buildDts(caps)
  log('Generated DTS:\n', dts.slice(0, 2000))

  const codemodeToolDef = await codemode(caps, dts)
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
