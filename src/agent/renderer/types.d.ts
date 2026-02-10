export {}

declare global {
  interface SecretsStatus {
    geminiApiKey: boolean
    googleOAuthClient: boolean
  }

  interface Window {
    api: {
      getSecretsStatus: () => Promise<SecretsStatus>
      setGeminiApiKey: (key: string) => Promise<void>
      setGoogleOAuthClient: (json: string) => Promise<void>
      chat: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<string>
    }
  }
}
