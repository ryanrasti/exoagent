import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Secrets
  getSecretsStatus: () => ipcRenderer.invoke('secrets:status'),
  setGeminiApiKey: (key: string) => ipcRenderer.invoke('secrets:setGeminiApiKey', key),
  setGoogleOAuthClient: (json: string) => ipcRenderer.invoke('secrets:setGoogleOAuthClient', json),

  // Chat
  chat: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    ipcRenderer.invoke('chat', message, history),
})
