/**
 * API client - works with both Electron IPC and HTTP transport
 *
 * Auto-detects environment:
 * - In Electron: uses window.api (exposed via preload)
 * - In browser dev mode: uses HTTP calls to /api/*
 */

const isElectron = typeof window !== 'undefined' && 'api' in window && window.api !== undefined

async function httpCall<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = await fetch(`/rpc/${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })

  const json = await res.json()

  if (!json.ok) {
    const err = new Error(json.error?.message || 'Unknown error') as Error & { code?: string }
    if (json.error?.stack) {
      err.stack = json.error.stack
    }
    if (json.error?.code) {
      err.code = json.error.code
    }
    throw err
  }

  return json.result as T
}

// Type-safe API that matches window.api interface
export const api = {
  getSecretsStatus: (): Promise<SecretsStatus> => {
    if (isElectron) return window.api.getSecretsStatus()
    return httpCall('secrets:status')
  },

  setGeminiApiKey: (key: string): Promise<void> => {
    if (isElectron) return window.api.setGeminiApiKey(key)
    return httpCall('secrets:setGeminiApiKey', key)
  },

  setGoogleOAuthClient: (json: string): Promise<void> => {
    if (isElectron) return window.api.setGoogleOAuthClient(json)
    return httpCall('secrets:setGoogleOAuthClient', json)
  },

  startGoogleOAuth: (): Promise<boolean> => {
    if (isElectron) return window.api.startGoogleOAuth()
    return httpCall('secrets:startGoogleOAuth')
  },

  clearGoogleTokens: (): Promise<void> => {
    if (isElectron) return window.api.clearGoogleTokens()
    return httpCall('secrets:clearGoogleTokens')
  },

  listThreads: (): Promise<Thread[]> => {
    if (isElectron) return window.api.listThreads()
    return httpCall('threads:list')
  },

  createThread: (): Promise<Thread> => {
    if (isElectron) return window.api.createThread()
    return httpCall('threads:create')
  },

  getThread: (threadId: string): Promise<{ thread: Thread, messages: Message[] }> => {
    if (isElectron) return window.api.getThread(threadId)
    return httpCall('threads:get', threadId)
  },

  chat: (threadId: string, message: string): Promise<ChatResult> => {
    if (isElectron) return window.api.chat(threadId, message)
    return httpCall('chat', threadId, message)
  },

  pinThread: (threadId: string): Promise<void> => {
    if (isElectron) return window.api.pinThread(threadId)
    return httpCall('threads:pin', threadId)
  },

  unpinThread: (threadId: string): Promise<void> => {
    if (isElectron) return window.api.unpinThread(threadId)
    return httpCall('threads:unpin', threadId)
  },

  deleteThread: (threadId: string): Promise<void> => {
    if (isElectron) return window.api.deleteThread(threadId)
    return httpCall('threads:delete', threadId)
  },
}
