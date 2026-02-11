import { useState, useEffect } from 'react'
import { SecretsPanel } from './components/SecretsPanel'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
}

function ToolCallItem({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const hasError = !!tc.error

  return (
    <div className={`border rounded mt-2 text-sm ${hasError ? 'border-red-700 bg-red-950/30' : 'border-neutral-700 bg-neutral-900'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-800/50 transition-colors"
      >
        <span className="text-neutral-500 text-xs">{expanded ? '▼' : '▶'}</span>
        <span className={`font-mono ${hasError ? 'text-red-400' : 'text-cyan-400'}`}>{tc.name}</span>
        {hasError && <span className="text-xs text-red-500">error</span>}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-neutral-700 space-y-2">
          <div>
            <span className="text-neutral-500 text-xs">args:</span>
            <pre className="text-neutral-300 text-xs mt-1 overflow-x-auto">{JSON.stringify(tc.args, null, 2)}</pre>
          </div>
          {hasError ? (
            <div>
              <span className="text-red-500 text-xs">error:</span>
              <pre className="text-red-400 text-xs mt-1">{tc.error}</pre>
            </div>
          ) : tc.result !== undefined && (
            <div>
              <span className="text-neutral-500 text-xs">result:</span>
              <pre className="text-green-400 text-xs mt-1 overflow-x-auto max-h-48 overflow-y-auto">{JSON.stringify(tc.result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolCallsSection({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false)
  const errorCount = toolCalls.filter(tc => tc.error).length

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>{toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}</span>
        {errorCount > 0 && <span className="text-red-500">({errorCount} error{errorCount !== 1 ? 's' : ''})</span>}
      </button>
      {expanded && (
        <div className="mt-1">
          {toolCalls.map(tc => (
            <ToolCallItem key={tc.id} tc={tc} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [isSecretsOpen, setIsSecretsOpen] = useState(false)
  const [secretsStatus, setSecretsStatus] = useState<SecretsStatus | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!window.api) {
      setSecretsStatus({ geminiApiKey: false, googleOAuthClient: false })
      return
    }
    window.api.getSecretsStatus().then(setSecretsStatus)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    if (!window.api) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const response = await window.api.chat(userMessage.content, history)

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (err) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
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
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-800 text-neutral-100'
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <ToolCallsSection toolCalls={msg.toolCalls} />
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
          window.api?.getSecretsStatus().then(setSecretsStatus)
        }}
      />
    </div>
  )
}
