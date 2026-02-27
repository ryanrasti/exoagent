import type { LanguageModel } from 'ai'
import { generateText } from 'ai'
import { z } from 'zod'
import { tool } from '../../exoeval/tool'

async function resolveModel(): Promise<{ model: LanguageModel, name: string }> {
  const providers: Record<string, () => Promise<{ model: LanguageModel, name: string }>> = {
    ANTHROPIC_API_KEY: async () => ({
      model: (await import('@ai-sdk/anthropic')).anthropic('claude-sonnet-4-20250514'),
      name: 'Anthropic Claude Sonnet',
    }),
    OPENAI_API_KEY: async () => ({
      model: (await import('@ai-sdk/openai')).openai('gpt-4o'),
      name: 'OpenAI GPT-4o',
    }),
    GOOGLE_GENERATIVE_AI_API_KEY: async () => ({
      model: (await import('@ai-sdk/google')).google('gemini-2.5-flash'),
      name: 'Google Gemini 2.5 Flash',
    }),
  }

  for (const [env, create] of Object.entries(providers)) {
    if (process.env[env]) {
      return await create()
    }
  }

  throw new Error(`No API key set. Set one of: ${Object.keys(providers).join(', ')}`)
}

export class LlmClient {
  private modelPromise: Promise<{ model: LanguageModel, name: string }> | null = null

  private getModel() {
    if (!this.modelPromise) {
      this.modelPromise = resolveModel()
    }
    return this.modelPromise
  }

  @tool(z.object({
    prompt: z.string(),
    system: z.string().optional(),
  }))
  async ask({ prompt, system }: { prompt: string, system?: string }): Promise<string> {
    const { model } = await this.getModel()
    const result = await generateText({
      model,
      system,
      prompt,
    })
    return result.text
  }

  @tool(z.object({
    prompt: z.string(),
    options: z.array(z.string()),
    system: z.string().optional(),
  }))
  async choose({ prompt, options, system }: { prompt: string, options: string[], system?: string }): Promise<string> {
    const { model } = await this.getModel()
    const optionsList = options.map((o, i) => `${i + 1}. ${o}`).join('\n')
    const result = await generateText({
      model,
      system: system ?? 'You are a helpful assistant. Respond with ONLY the exact text of the chosen option, nothing else.',
      prompt: `${prompt}\n\nOptions:\n${optionsList}`,
    })
    return result.text.trim()
  }
}
