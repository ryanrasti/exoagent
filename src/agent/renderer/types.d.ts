export {}

declare global {
  interface SecretsStatus {
    geminiApiKey: boolean
    googleOAuthClient: boolean
    googleTokens?: boolean
  }

  interface ToolCall {
    id: string
    name: string
    args: Record<string, unknown>
    result?: unknown
    error?: string
  }

  interface ChatResponse {
    text: string
    toolCalls: ToolCall[]
  }

  interface Window {
    api: {
      getSecretsStatus: () => Promise<SecretsStatus>
      setGeminiApiKey: (key: string) => Promise<void>
      setGoogleOAuthClient: (json: string) => Promise<void>
      startGoogleOAuth: () => Promise<boolean>
      clearGoogleTokens: () => Promise<void>
      chat: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<ChatResponse>
    }
  }
}
