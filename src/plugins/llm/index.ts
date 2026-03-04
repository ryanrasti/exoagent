import { z } from 'zod'
import { tool } from '../../exoeval/tool'
import { google } from '@ai-sdk/google'
import { generateText, Output, stepCountIs } from 'ai'
import { codemode } from '../../code-mode'

const SubagentOptionsSchema = z.object({
  prompt: z.string(),
  system: z.string().optional(),
  maxTurns: z.number().optional(),
  capabilities: z.object({
    raw: z.record(z.any(), z.any()),
    dts: z.string(),
  }).optional(),
  options: z.array(z.string()).optional(),
})
export type SubagentOptions = z.infer<typeof SubagentOptionsSchema>

const runSubagent = async (options: SubagentOptions) => {
  const result = await generateText({
    model: google('gemini-2.5-flash'),
    tools: options.capabilities ? { codemode: await codemode(options.capabilities.raw, options.capabilities.dts) } : {},
    stopWhen: stepCountIs(options.maxTurns ?? 1),
    system: options.system,
    prompt: options.prompt,
    temperature: 0,
    seed: 1,
    output: Output.object({schema: 
      z.object({
        result: options.options ? z.enum(options.options).optional() : z.string().optional(),
        error: z.string().optional(),
      })
    }),
  })
  return result.output
}

export class Llm {
  @tool(z.object({
    prompt: z.string(),
    system: z.string().optional(),
    options: z.array(z.string()).optional(),
  }))
  async ask({ prompt, system, options }: { prompt: string; system?: string; options?: string[] }) {
    const result = await runSubagent({
      prompt,
      system,
      maxTurns: 1,
      options,
    })
    return result
  }

  @tool(SubagentOptionsSchema)
  async subagent(options: SubagentOptions) {
    return await runSubagent(options)
  }
}
