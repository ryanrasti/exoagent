import { useState, useEffect } from 'react'
import { api } from './api'
import { SecretsPanel } from './components/SecretsPanel'

/** Display message derived from Turn for UI */
interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  data?: unknown
  taints?: Taint[]
  isError?: boolean
  errorStack?: string
  errorCode?: string
}

function TaintsDisplay({ taints }: { taints: Taint[] }) {
  const [expanded, setExpanded] = useState(false)

  if (taints.length === 0) return null

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>{taints.length} taint{taints.length !== 1 ? 's' : ''}</span>
      </button>
      {expanded && (
        <div className="mt-1 text-xs text-neutral-500">
          {taints.map(([type, params], i) => (
            <div key={i} className="font-mono">
              {type}
              {params.principals && params.principals.length > 0 && (
                <span className="text-neutral-600"> [{params.principals.join(', ')}]</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DataDisplay({ data }: { data: unknown }) {
  const [expanded, setExpanded] = useState(false)

  if (data === null || data === undefined) return null

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>context data</span>
      </button>
      {expanded && (
        <pre className="mt-1 text-xs text-neutral-500 overflow-x-auto max-h-48 overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ErrorCodeDisplay({ code }: { code: string }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors"
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>executed code</span>
      </button>
      {expanded && (
        <pre className="mt-1 text-xs text-red-300/70 overflow-x-auto max-h-64 overflow-y-auto bg-red-950/30 p-2 rounded">
          {code}
        </pre>
      )}
    </div>
  )
}

function ErrorStackDisplay({ stack }: { stack: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors"
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>stack trace</span>
      </button>
      {expanded && (
        <pre className="mt-1 text-xs text-red-300/70 overflow-x-auto max-h-48 overflow-y-auto">
          {stack}
        </pre>
      )}
    </div>
  )
}

export default function App() {
  const [isSecretsOpen, setIsSecretsOpen] = useState(false)
  const [secretsStatus, setSecretsStatus] = useState<SecretsStatus | null>(null)
  const [history, setHistory] = useState<Turn[]>([])
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    api.getSecretsStatus().then(setSecretsStatus)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userContent = input.trim()
    const userTurn: Turn = { role: 'user', content: userContent }
    const userMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
    }

    setHistory(prev => [...prev, userTurn])
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const result = await api.chat(userContent, history)

      const assistantTurn: Turn = {
        role: 'assistant',
        response: result.response,
        data: result.data,
        taints: result.taints,
      }
      const assistantMessage: DisplayMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.response,
        data: result.data,
        taints: result.taints,
      }

      setHistory(prev => [...prev, assistantTurn])
      setMessages(prev => [...prev, assistantMessage])
    }
    catch (err) {
      const errorMessage: DisplayMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Unknown error',
        isError: true,
        errorStack: err instanceof Error ? err.stack : undefined,
        errorCode: err instanceof Error ? (err as Error & { code?: string }).code : undefined,
      }
      setMessages(prev => [...prev, errorMessage])
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900">
        <div className="flex items-center gap-2">
          <object type="image/svg+xml" data="./logo-x-pulse.svg" className="w-8 h-8" />
          <h1 className="text-sm font-semibold text-neutral-200">ExoAgent</h1>
        </div>
        <button
          onClick={() => setIsSecretsOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
        >
          <span>🔑</span>
          <span>Secrets</span>
          {!secretsStatus?.geminiApiKey && (
            <span className="px-1.5 py-0.5 text-xs bg-yellow-600 rounded-full">!</span>
          )}
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
            <p>Start a conversation...</p>
            {!secretsStatus?.geminiApiKey && (
              <p className="text-xs text-yellow-500">Configure your Gemini API key in Secrets first</p>
            )}
          </div>
        )}
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2 rounded-lg ${
                msg.isError
                  ? 'bg-red-900/50 border border-red-700 text-red-200'
                  : msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-neutral-800 text-neutral-100'
              }`}
            >
              {msg.isError && (
                <div className="text-xs text-red-400 font-semibold mb-1">Error</div>
              )}
              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              {msg.errorCode && (
                <ErrorCodeDisplay code={msg.errorCode} />
              )}
              {msg.errorStack && (
                <ErrorStackDisplay stack={msg.errorStack} />
              )}
              {msg.taints && msg.taints.length > 0 && (
                <TaintsDisplay taints={msg.taints} />
              )}
              {msg.data !== undefined && (
                <DataDisplay data={msg.data} />
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="px-4 py-2 rounded-lg bg-neutral-800 text-neutral-400">
              Thinking...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t border-neutral-800">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isLoading}
          className="flex-1 px-4 py-3 bg-neutral-900 border border-neutral-700 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          Send
        </button>
      </form>

      {/* Secrets Panel */}
      <SecretsPanel
        isOpen={isSecretsOpen}
        onClose={() => {
          setIsSecretsOpen(false)
          api.getSecretsStatus().then(setSecretsStatus)
        }}
      />
    </div>
  )
}
