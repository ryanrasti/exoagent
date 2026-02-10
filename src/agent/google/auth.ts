import { google } from 'googleapis'
import { authenticate } from '@google-cloud/local-auth'
import { safeStorage, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]

export class GoogleAuth {
  private tokenPath: string

  constructor(private credentialsPath: string) {
    this.tokenPath = path.join(app.getPath('userData'), 'google-tokens.enc')
  }

  async getClient() {
    if (fs.existsSync(this.tokenPath)) {
      try {
        const encrypted = fs.readFileSync(this.tokenPath)
        const saved = JSON.parse(safeStorage.decryptString(encrypted))

        const creds = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf-8'))
        const { client_id, client_secret } = creds.installed || creds.web

        const client = new google.auth.OAuth2(client_id, client_secret)
        client.setCredentials(saved)
        return client
      } catch {
        // Will re-auth
      }
    }

    const client = await authenticate({
      keyfilePath: this.credentialsPath,
      scopes: SCOPES,
    })

    if (client.credentials) {
      const encrypted = safeStorage.encryptString(JSON.stringify(client.credentials))
      fs.writeFileSync(this.tokenPath, encrypted)
    }

    return client
  }

  hasSavedTokens(): boolean {
    return fs.existsSync(this.tokenPath)
  }

  logout(): void {
    if (fs.existsSync(this.tokenPath)) {
      fs.unlinkSync(this.tokenPath)
    }
  }
}
