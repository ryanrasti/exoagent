export {}

declare global {
  interface SecretsStatus {
    geminiApiKey: boolean
    googleOAuthClient: boolean
    googleTokens?: boolean
  }

  /** Taint tuple: [type, params] */
  type Taint = [string, { principals?: string[] }]

  /** A turn in the conversation history */
  type Turn =
    | { role: 'user', content: string }
    | { role: 'assistant', response: string, data: unknown, taints: Taint[] }

  /** Result from a chat turn */
  interface TurnResult {
    response: string
    data: unknown
    taints: Taint[]
    code: string
  }

  interface Window {
    api: {
      getSecretsStatus: () => Promise<SecretsStatus>
      setGeminiApiKey: (key: string) => Promise<void>
      setGoogleOAuthClient: (json: string) => Promise<void>
      startGoogleOAuth: () => Promise<boolean>
      clearGoogleTokens: () => Promise<void>
      chat: (message: string, history: Turn[]) => Promise<TurnResult>
    }
  }
}
