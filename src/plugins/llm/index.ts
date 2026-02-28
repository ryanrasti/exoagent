import { z } from 'zod'
import { tool } from '../../exoeval/tool'
import { runSubagent } from '../subagent'

export class LlmClient {
  @tool(z.object({
    prompt: z.string(),
    system: z.string().optional(),
  }))
  async ask({ prompt, system }: { prompt: string; system?: string }): Promise<string> {
    const result = await runSubagent({
      prompt,
      system,
      maxTurns: 1,
    })
    return String(result.result ?? '')
  }

  @tool(z.object({
    prompt: z.string(),
    options: z.array(z.string()),
    system: z.string().optional(),
  }))
  async choose({ prompt, options, system }: { prompt: string; options: string[]; system?: string }): Promise<string> {
    const optionsList = options.map((o, i) => `${i + 1}. ${o}`).join('\n')
    const result = await runSubagent({
      prompt: `${prompt}\n\nOptions:\n${optionsList}`,
      system: system ?? 'You are a helpful assistant. Respond with ONLY the exact text of the chosen option, nothing else.',
      maxTurns: 1,
    })
    return String(result.result ?? '').trim()
  }
}
