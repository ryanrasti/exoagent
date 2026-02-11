import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function SecretsPanel({ isOpen, onClose }: Props) {
  const [status, setStatus] = useState<SecretsStatus | null>(null)
  const [geminiKey, setGeminiKey] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      api.getSecretsStatus().then(setStatus)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSaveGemini = async () => {
    if (!geminiKey.trim()) return
    setSaving('gemini')
    try {
      await api.setGeminiApiKey(geminiKey.trim())
      setStatus(s => s ? { ...s, geminiApiKey: true } : s)
      setGeminiKey('')
    } finally {
      setSaving(null)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSaving('google')
    try {
      const content = await file.text()
      JSON.parse(content) // validate it's JSON
      await api.setGoogleOAuthClient(content)
      setStatus(s => s ? { ...s, googleOAuthClient: true } : s)
    } catch (err) {
      console.error('Failed to save OAuth client:', err)
      alert(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setSaving(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleConnectGoogle = async () => {
    setSaving('oauth')
    // Re-enable button after 5s while OAuth continues in background
    setTimeout(() => setSaving(null), 5000)
    try {
      await api.startGoogleOAuth()
      setStatus(s => s ? { ...s, googleTokens: true } : s)
    } catch (err) {
      console.warn('OAuth failed:', err)
    } finally {
      setSaving(null)
    }
  }

  const handleDisconnectGoogle = async () => {
    setSaving('oauth')
    try {
      await api.clearGoogleTokens()
      setStatus(s => s ? { ...s, googleTokens: false } : s)
    } catch (err) {
      console.error('Failed to disconnect:', err)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-neutral-200">Secrets</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300"
          >
            ✕
          </button>
        </div>

        {/* Gemini API Key */}
        <div className="mb-6 p-4 bg-neutral-800/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-neutral-300">Gemini API</h3>
            {status?.geminiApiKey ? (
              <span className="text-xs text-green-500 flex items-center gap-1">
                <span>●</span> Configured
              </span>
            ) : (
              <span className="text-xs text-yellow-500 flex items-center gap-1">
                <span>○</span> Not set
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500 mb-3">
            Required for LLM calls.{' '}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              Get an API key
            </a>
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={geminiKey}
              onChange={e => setGeminiKey(e.target.value)}
              placeholder={status?.geminiApiKey ? '••••••••' : 'AIza...'}
              className="flex-1 px-3 py-2 text-sm bg-neutral-800 border border-neutral-700 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
            />
            <button
              onClick={handleSaveGemini}
              disabled={saving === 'gemini' || !geminiKey.trim()}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded"
            >
              {saving === 'gemini' ? '...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Google OAuth */}
        <div className="p-4 bg-neutral-800/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-neutral-300">Google OAuth (Gmail, Calendar)</h3>
            {status?.googleTokens ? (
              <span className="text-xs text-green-500 flex items-center gap-1">
                <span>●</span> Connected
              </span>
            ) : status?.googleOAuthClient ? (
              <span className="text-xs text-yellow-500 flex items-center gap-1">
                <span>○</span> Client configured, not connected
              </span>
            ) : (
              <span className="text-xs text-yellow-500 flex items-center gap-1">
                <span>○</span> Not set
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500 mb-3">
            Upload the OAuth credentials JSON from Google Cloud Console, then connect your account.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={saving === 'google'}
              className="px-4 py-2 text-sm bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 rounded"
            >
              {saving === 'google' ? 'Uploading...' : status?.googleOAuthClient ? 'Replace credentials' : 'Upload credentials.json'}
            </button>
            {status?.googleOAuthClient && !status?.googleTokens && (
              <button
                onClick={handleConnectGoogle}
                disabled={saving === 'oauth'}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded"
              >
                {saving === 'oauth' ? 'Connecting...' : 'Connect Google Account'}
              </button>
            )}
            {status?.googleTokens && (
              <button
                onClick={handleDisconnectGoogle}
                disabled={saving === 'oauth'}
                className="px-4 py-2 text-sm bg-red-600/80 hover:bg-red-600 disabled:opacity-50 rounded"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
