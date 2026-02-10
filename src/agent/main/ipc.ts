import { ipcMain } from 'electron'
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getSecret, setSecret, getSecretsStatus } from './db/secrets'

export function setupIpc(): void {
  // Secrets
  ipcMain.handle('secrets:status', () => getSecretsStatus())

  ipcMain.handle('secrets:setGeminiApiKey', (_, apiKey: string) => {
    return setSecret('geminiApiKey', apiKey)
  })

  ipcMain.handle('secrets:setGoogleOAuthClient', (_, clientJson: string) => {
    return setSecret('googleOAuthClient', clientJson)
  })

  // Chat
  ipcMain.handle('chat', async (_, message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    const apiKey = await getSecret('geminiApiKey')
    if (!apiKey) {
      throw new Error('API key not configured')
    }

    const google = createGoogleGenerativeAI({ apiKey })

    const response = await generateText({
      model: google('gemini-2.0-flash'),
      messages: [
        ...history,
        { role: 'user', content: message },
      ],
    })

    return response.text
  })
}
