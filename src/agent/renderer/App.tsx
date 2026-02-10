import { useState, useEffect } from 'react'
import { SecretsPanel } from './components/SecretsPanel'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
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
        content: response,
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
