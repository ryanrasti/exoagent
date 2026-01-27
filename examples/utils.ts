import process from 'node:process'
import * as readline from 'node:readline'
import { z } from 'zod'

export interface ChatResult {
  text: string
  steps: Array<{ toolCalls?: Array<{ toolName: string, input: unknown }>, toolResults?: Array<{ output: unknown }> }>
}

export interface ReplOptions {
  title: string
  context: string
  chat: (prompt: string) => Promise<ChatResult>
}

const toolCallInputSchema = z.object({
  code: z.string(),
})

const toolCallOutputSchema = z.object({
  results: z.array(z.unknown()).optional(),
  sql: z.string().optional(),
  parameters: z.array(z.unknown()).optional(),
})

export async function getModel() {
  const modelsByEnv = {
    OPENAI_API_KEY: async () => ({ model: (await import('@ai-sdk/openai')).openai('gpt-4o'), name: 'OpenAI GPT-4o' }),
    ANTHROPIC_API_KEY: async () => ({ model: (await import('@ai-sdk/anthropic')).anthropic('claude-sonnet-4-20250514'), name: 'Anthropic Claude Sonnet 4 20250514' }),
    GOOGLE_GENERATIVE_AI_API_KEY: async () => ({ model: (await import('@ai-sdk/google')).google('gemini-2.5-flash'), name: 'Google Gemini 2.5 Flash' }),
  }
  for (const [env, spec] of Object.entries(modelsByEnv)) {
    if (process.env[env]) {
      const { model, name } = await spec()
      return { model, name }
    }
  }
  throw new Error(`No API key set. Please set one of the following environment variables: ${Object.keys(modelsByEnv).join(', ')}`)
}

/**
 * Core REPL logic as an async generator.
 * Yields strings to output, receives user input via next(input).
 */
export async function* replCore(options: ReplOptions): AsyncGenerator<string, void, string | undefined> {
  const { title, context, chat } = options

  yield `=== ${title} ===`
  yield context
  yield 'Type your message or "quit" to exit.\n'

  while (true) {
    const input: string | undefined = yield 'You: '

    if (input === undefined) {
      continue
    }

    const trimmed = input.trim()
    if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
      yield 'Goodbye!'
      return
    }

    if (!trimmed) {
      continue
    }

    try {
      const response = await chat(trimmed)

      // Display tool calls and results
      for (const step of response.steps) {
        if (step.toolCalls) {
          for (const call of step.toolCalls) {
            // Parse and validate input
            const parsed = typeof call.input === 'string' ? JSON.parse(call.input) : call.input
            const inputValidation = toolCallInputSchema.safeParse(parsed)
            if (!inputValidation.success) {
              continue
            }
            const input = inputValidation.data

            yield `\n→ Tool Call (args): ${call.toolName}`
            yield input.code
          }
        }
        if (step.toolResults) {
          for (const result of step.toolResults) {
            // Parse and validate output
            const outputValidation = toolCallOutputSchema.safeParse(result.output)
            if (!outputValidation.success) {
              continue
            }
            const output = outputValidation.data

            if (output.sql) {
              yield `\n→ SQL Executed`
              yield output.sql
              if (output.parameters?.length) {
                yield `\n→ Parameters: ${JSON.stringify(output.parameters)}`
              }
            }
            if (output.results !== undefined) {
              yield `\n→ Tool Result (values)`
              yield JSON.stringify(output.results, null, 2)
            }
          }
        }
      }

      yield `\nAssistant: ${response.text}\n`
    }
    catch (error) {
      if (error instanceof Error) {
        yield `Error: ${error.message}`
        if (error.stack) {
          yield error.stack
        }
      }
      else {
        yield `Error: ${error}`
      }
    }
  }
}

/**
 * Run the REPL interactively in the terminal.
 */
export async function runRepl(options: ReplOptions): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const repl = replCore(options)

  const processNext = async (input?: string) => {
    const result = await repl.next(input)
    if (result.done) {
      rl.close()
      return
    }

    const output = result.value

    // If output ends with 'You: ', it's a prompt for input
    if (output === 'You: ') {
      rl.question(output, async (userInput) => {
        await processNext(userInput)
      })
    }
    else {
      // eslint-disable-next-line no-console
      console.log(output)
      await processNext()
    }
  }

  await processNext()
}
