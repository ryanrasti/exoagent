import { google } from 'googleapis'
import type { Auth } from 'googleapis'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import type { BrowserClient } from '../browser'

export interface StoredTokens {
  access_token?: string | null
  refresh_token?: string | null
  expiry_date?: number | null
}

export interface ClientCredentials {
  client_id: string
  client_secret: string
  project_id?: string
}

export function parseClientConfig(json: string): ClientCredentials {
  const creds = JSON.parse(json)
  const { client_id, client_secret, project_id } = creds.installed || creds.web
  if (!client_id || !client_secret) {
    throw new Error('Invalid OAuth client JSON: missing client_id or client_secret')
  }
  return { client_id, client_secret, project_id }
}

export interface OAuthFlowOptions {
  scopes: string[]
  /** Browser client for automation. If not provided, opens system browser. */
  browser?: BrowserClient
  /** Open system browser (only used if browser is not provided). Default: true */
  openBrowser?: boolean
}

/**
 * Generate the OAuth URL for the given credentials and scopes.
 */
export function generateOAuthUrl(
  clientJson: string,
  scopes: string[],
  redirectUri: string,
): string {
  const { client_id, client_secret } = parseClientConfig(clientJson)
  const client = new google.auth.OAuth2(client_id, client_secret, redirectUri)
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  })
}

/**
 * Start an OAuth flow by spinning up a local server to receive the callback.
 * Can use browser automation or open the system browser.
 */
export async function startOAuthFlow(
  clientJson: string,
  options: OAuthFlowOptions,
): Promise<StoredTokens> {
  const { client_id, client_secret } = parseClientConfig(clientJson)
  const { scopes, browser, openBrowser = true } = options

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, `http://localhost`)
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`<html><body style="font-family: system-ui; text-align: center; padding: 40px;">
            <h1>Authorization failed</h1>
            <p>${error}</p>
            <p>You can close this window.</p>
          </body></html>`)
          server.close()
          reject(new Error(`OAuth error: ${error}`))
          return
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<h1>Missing authorization code</h1>')
          return
        }

        const port = (server.address() as AddressInfo).port
        const redirectUri = `http://localhost:${port}`
        const client = new google.auth.OAuth2(client_id, client_secret, redirectUri)

        const { tokens } = await client.getToken(code)

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body style="font-family: system-ui; text-align: center; padding: 40px;">
          <h1>Authorization successful!</h1>
          <p>You can close this tab and return to the app.</p>
        </body></html>`)
        server.close()

        resolve({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date,
        })
      }
      catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end('<h1>Error exchanging code</h1><p>You can close this window.</p>')
        server.close()
        reject(err)
      }
    })

    server.listen(0, '127.0.0.1', async () => {
      const port = (server.address() as AddressInfo).port
      const redirectUri = `http://localhost:${port}`
      const authUrl = generateOAuthUrl(clientJson, scopes, redirectUri)

      console.log('OAuth URL:', authUrl)

      if (browser) {
        // Use browser automation
        try {
          await browser.navigate({ url: authUrl })
        }
        catch (err) {
          server.close()
          reject(err)
        }
      }
      else if (openBrowser) {
        // Clear LD_LIBRARY_PATH to avoid NixOS library conflicts with system browser
        const env = { ...process.env }
        delete env.LD_LIBRARY_PATH
        spawn('xdg-open', [authUrl], { env, detached: true, stdio: 'ignore' }).unref()
      }
    })

    server.on('error', reject)
  })
}

/**
 * Create an authenticated OAuth2 client from stored tokens.
 */
export function createAuthenticatedClient(
  clientJson: string,
  tokens: StoredTokens,
): Auth.OAuth2Client {
  const { client_id, client_secret } = parseClientConfig(clientJson)
  const client = new google.auth.OAuth2(client_id, client_secret)
  client.setCredentials(tokens)
  return client
}

/**
 * Helper to load credentials from a JSON file.
 */
export async function loadCredentials(path: string): Promise<string> {
  return readFile(path, 'utf-8')
}

/**
 * Helper to save tokens to a JSON file.
 */
export async function saveTokens(path: string, tokens: StoredTokens): Promise<void> {
  await writeFile(path, JSON.stringify(tokens, null, 2))
}

/**
 * Helper to load tokens from a JSON file.
 */
export async function loadTokens(path: string): Promise<StoredTokens> {
  const content = await readFile(path, 'utf-8')
  return JSON.parse(content)
}

// Common Google API scopes
export const SCOPES = {
  GMAIL_READONLY: 'https://www.googleapis.com/auth/gmail.readonly',
  GMAIL_SEND: 'https://www.googleapis.com/auth/gmail.send',
  GMAIL_MODIFY: 'https://www.googleapis.com/auth/gmail.modify',
  CALENDAR_READONLY: 'https://www.googleapis.com/auth/calendar.readonly',
  CALENDAR_EVENTS: 'https://www.googleapis.com/auth/calendar.events',
} as const
