import type { Auth } from 'googleapis'
import { google } from 'googleapis'
import type { BrowserClient } from '../browser'
import type { StoredTokens } from '../oauth'
import { createAuthenticatedClient, parseClientConfig, startOAuthFlow } from '../oauth'
import { Storage } from '../storage'
import { GmailClient } from '../gmail'

export interface GoogleStorageSchema {
  credentials: {
    client_id: string
    client_secret: string
    project_id?: string
  }
  tokens: StoredTokens
}

export const SCOPES = {
  GMAIL_READONLY: 'https://www.googleapis.com/auth/gmail.readonly',
  GMAIL_SEND: 'https://www.googleapis.com/auth/gmail.send',
  GMAIL_MODIFY: 'https://www.googleapis.com/auth/gmail.modify',
  CALENDAR_READONLY: 'https://www.googleapis.com/auth/calendar.readonly',
  CALENDAR_EVENTS: 'https://www.googleapis.com/auth/calendar.events',
} as const

const GMAIL_SCOPES = [SCOPES.GMAIL_READONLY, SCOPES.GMAIL_SEND]
const CALENDAR_SCOPES = [SCOPES.CALENDAR_READONLY, SCOPES.CALENDAR_EVENTS]

export class GoogleProvider {
  private storage: Storage<GoogleStorageSchema>
  private authClient: Auth.OAuth2Client | null = null

  constructor(
    private browser: BrowserClient,
    private projectId: string,
  ) {
    this.storage = new Storage<GoogleStorageSchema>(`google-${projectId}`)
  }

  /**
   * Get or create an authenticated OAuth2 client.
   * If tokens don't exist or need refresh, runs the OAuth flow.
   */
  async getAuth(scopes: string[]): Promise<Auth.OAuth2Client> {
    // Check for existing tokens
    const tokens = await this.storage.get('tokens')
    const credentials = await this.storage.get('credentials')

    if (!credentials) {
      throw new Error(
        `No credentials found for project ${this.projectId}. ` +
        `Run setupOAuthConsole() first or set credentials manually.`
      )
    }

    const clientJson = JSON.stringify({ installed: credentials })

    if (tokens) {
      // Check if token needs refresh
      const expiresAt = tokens.expiry_date ?? 0
      const isExpired = Date.now() >= expiresAt - 60000 // 1 min buffer

      if (!isExpired) {
        // Token is still valid
        this.authClient = createAuthenticatedClient(clientJson, tokens)
        return this.authClient
      }

      // Try to refresh
      if (tokens.refresh_token) {
        try {
          const auth = createAuthenticatedClient(clientJson, tokens)
          const { credentials: newTokens } = await auth.refreshAccessToken()
          await this.storage.set('tokens', {
            access_token: newTokens.access_token,
            refresh_token: newTokens.refresh_token ?? tokens.refresh_token,
            expiry_date: newTokens.expiry_date,
          })
          this.authClient = auth
          return this.authClient
        }
        catch {
          // Refresh failed, need to re-auth
        }
      }
    }

    // No valid tokens, run OAuth flow
    const newTokens = await startOAuthFlow(clientJson, {
      scopes,
      browser: this.browser,
    })
    await this.storage.set('tokens', newTokens)

    this.authClient = createAuthenticatedClient(clientJson, newTokens)
    return this.authClient
  }

  /**
   * Set credentials manually (from credentials.json file content).
   */
  async setCredentials(clientJson: string): Promise<void> {
    const creds = parseClientConfig(clientJson)
    await this.storage.set('credentials', creds)
  }

  /**
   * Check if we have valid credentials stored.
   */
  async hasCredentials(): Promise<boolean> {
    const creds = await this.storage.get('credentials')
    return creds !== null
  }

  /**
   * Check if we have valid tokens stored.
   */
  async hasTokens(): Promise<boolean> {
    const tokens = await this.storage.get('tokens')
    return tokens !== null
  }

  /**
   * Get a Gmail client.
   */
  async gmail(): Promise<GmailClient> {
    const auth = await this.getAuth(GMAIL_SCOPES)
    return new GmailClient(auth)
  }

  // TODO: Add calendar(), drive(), etc. as needed
}
