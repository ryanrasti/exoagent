export {}

declare global {
  interface SecretsStatus {
    geminiApiKey: boolean
    googleOAuthClient: boolean
    googleTokens?: boolean
  }

  /** Taint tuple: [type, params] */
  type Taint = [string, { principals?: string[] }]

  /** A redaction marker for content moved to a subthread */
  interface Redaction {
    subthread_id: string
    taints: Taint[]
  }

  /** Thread metadata */
  interface Thread {
    id: string
    parent_id: string | null
    title: string | null
    pinned: number
    status: string
    taints: Taint[]
    created_at: number | null
    updated_at: number | null
  }

  /** Message in a thread */
  interface Message {
    id: string
    thread_id: string
    role: 'user' | 'assistant'
    content: string
    data: unknown
    taints: Taint[]
    code: string | null
    created_at: number | null
  }

  /** Result from a chat turn */
  interface ChatResult {
    response: string
    data: unknown
    taints: Taint[]
    code: string
    /** If the response was forked to a subthread */
    forked?: {
      subthreadId: string
      taints: Taint[]
    }
  }

  interface Window {
    api: {
      getSecretsStatus: () => Promise<SecretsStatus>
      setGeminiApiKey: (key: string) => Promise<void>
      setGoogleOAuthClient: (json: string) => Promise<void>
      startGoogleOAuth: () => Promise<boolean>
      clearGoogleTokens: () => Promise<void>
      listThreads: () => Promise<Thread[]>
      createThread: () => Promise<Thread>
      getThread: (threadId: string) => Promise<{ thread: Thread, messages: Message[] }>
      getSubthreads: (parentId: string) => Promise<Thread[]>
      notifyMainThread: (subthreadId: string, messageContent: string) => Promise<{ success: boolean, parentId: string }>
      chat: (threadId: string, message: string) => Promise<ChatResult>
      pinThread: (threadId: string) => Promise<void>
      unpinThread: (threadId: string) => Promise<void>
      deleteThread: (threadId: string) => Promise<void>
    }
  }
}
