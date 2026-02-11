import { google, Auth } from 'googleapis'
import { shell } from 'electron'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]

export interface StoredTokens {
  access_token?: string | null
  refresh_token?: string | null
  expiry_date?: number | null
}

export function parseClientConfig(json: string): { client_id: string; client_secret: string } {
  const creds = JSON.parse(json)
  const { client_id, client_secret } = creds.installed || creds.web
  if (!client_id || !client_secret) {
    throw new Error('Invalid OAuth client JSON')
  }
  return { client_id, client_secret }
}

export async function startOAuthFlow(clientJson: string): Promise<StoredTokens> {
  const { client_id, client_secret } = parseClientConfig(clientJson)

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, `http://localhost`)
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`<h1>Authorization failed</h1><p>${error}</p><p>You can close this window.</p>`)
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
        res.end('<html><body style="font-family: system-ui; text-align: center; padding: 40px;"><h1>✓ Authorization successful!</h1><p>You can close this tab and return to the app.</p></body></html>')
        server.close()

        resolve({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date,
        })
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end('<h1>Error exchanging code</h1><p>You can close this window.</p>')
        server.close()
        reject(err)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const redirectUri = `http://localhost:${port}`
      const client = new google.auth.OAuth2(client_id, client_secret, redirectUri)

      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
      })

      console.log('Opening OAuth URL:', authUrl)
      // Clear LD_LIBRARY_PATH to avoid NixOS library conflicts with system browser
      const env = { ...process.env }
      delete env.LD_LIBRARY_PATH
      const { spawn } = require('node:child_process')
      spawn('xdg-open', [authUrl], { env, detached: true, stdio: 'ignore' }).unref()
    })

    server.on('error', reject)
  })
}

export function createAuthenticatedClient(clientJson: string, tokens: StoredTokens): Auth.OAuth2Client {
  const { client_id, client_secret } = parseClientConfig(clientJson)
  const client = new google.auth.OAuth2(client_id, client_secret)
  client.setCredentials(tokens)
  return client
}
