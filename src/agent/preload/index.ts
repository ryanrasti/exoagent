import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Secrets
  getSecretsStatus: () => ipcRenderer.invoke('secrets:status'),
  setGeminiApiKey: (key: string) => ipcRenderer.invoke('secrets:setGeminiApiKey', key),
  setGoogleOAuthClient: (json: string) => ipcRenderer.invoke('secrets:setGoogleOAuthClient', json),
  startGoogleOAuth: () => ipcRenderer.invoke('secrets:startGoogleOAuth'),
  clearGoogleTokens: () => ipcRenderer.invoke('secrets:clearGoogleTokens'),

  // Threads
  listThreads: () => ipcRenderer.invoke('threads:list'),
  createThread: () => ipcRenderer.invoke('threads:create'),
  getThread: (threadId: string) => ipcRenderer.invoke('threads:get', threadId),
  getSubthreads: (parentId: string) => ipcRenderer.invoke('threads:subthreads', parentId),
  notifyMainThread: (subthreadId: string, messageContent: string) => ipcRenderer.invoke('threads:notifyMain', subthreadId, messageContent),
  pinThread: (threadId: string) => ipcRenderer.invoke('threads:pin', threadId),
  unpinThread: (threadId: string) => ipcRenderer.invoke('threads:unpin', threadId),
  deleteThread: (threadId: string) => ipcRenderer.invoke('threads:delete', threadId),

  // Chat
  chat: (threadId: string, message: string) => ipcRenderer.invoke('chat', threadId, message),
})
