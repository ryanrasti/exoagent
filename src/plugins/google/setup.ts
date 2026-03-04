import type { BrowserClient } from '../browser'
import type { SubagentOptions } from '../llm'
import { z } from 'zod'
import { tool } from '../../exoeval/tool'

const BROWSER_AGENT_SYSTEM = `You are a browser automation agent. Use api.browser to navigate and interact with web pages.

**DO ONE STEP AT A TIME.** Each codemode call should do ONE small action:
1. Navigate to a URL, take snapshot, return what you see
2. Click a button, take snapshot, return result
3. Fill a form field, take snapshot, return result

Do NOT try to do the entire workflow in one codemode call. Return partial progress and continue in the next turn.

**CRITICAL - HOW TO CLICK ELEMENTS:**
- NEVER use click() with CSS selectors - they DO NOT work
- NEVER use [ref=...] values - they are NOT valid selectors
- ONLY use clickRole({ role: '...', name: '...' })
- Copy the role and name EXACTLY from the snapshot
- Example: snapshot shows 'button "Submit"' -> clickRole({ role: 'button', name: 'Submit' })
- Example: snapshot shows 'row "My Item Project my-id"' -> clickRole({ role: 'row', name: 'My Item Project my-id' })

**CRITICAL - HOW TO FILL FORM FIELDS:**
- NEVER use type() with CSS selectors - they DO NOT work
- Use fillByLabel({ label: '...', text: '...' }) to fill form fields
- Example: snapshot shows 'textbox "Name"' -> fillByLabel({ label: 'Name', text: 'My Value' })

**CRITICAL - ONLY USE snapshot() FOR PAGE STATE:**
- NEVER use content() - it returns raw HTML which is too large
- ONLY use snapshot() to see the page state`

/** Wrapper that exposes browser methods and log directly on api */
@tool()
class SubagentApi {
  private _browser: BrowserClient
  private _logFn: (...args: unknown[]) => void

  constructor(browser: BrowserClient, logFn: (...args: unknown[]) => void) {
    this._browser = browser
    this._logFn = logFn
  }

  @tool()
  get browser(): BrowserClient {
    return this._browser
  }

  @tool(z.string())
  log(message: string) {
    this._logFn(`[subagent] ${message}`)
  }

  async dts() {
    const browserDts = await this._browser.dts()
    return browserDts + `\nexport declare class SubagentApi { browser: BrowserClient; log(message: string): void }`
  }
}

@tool()
export class GoogleSetup {
  private getBrowser: () => BrowserClient
  private subagent: (options: SubagentOptions) => Promise<{ result?: string; error?: string }>
  private log: (...args: unknown[]) => void

  constructor(
    getBrowser: () => BrowserClient,
    subagent: (options: SubagentOptions) => Promise<{ result?: string; error?: string }>,
    log: (...args: unknown[]) => void = console.log,
  ) {
    this.getBrowser = getBrowser
    this.subagent = subagent
    this.log = log
  }

  /**
   * Step 1: Find project by name and return its ID
   */
  @tool(z.object({ projectName: z.string() }))
  async getProjectId({ projectName }: { projectName: string }): Promise<string> {
    const browser = this.getBrowser()
    const api = new SubagentApi(browser, this.log)
    const apiDts = await api.dts()

    this.log(`Finding project "${projectName}"...`)

    const result = await this.subagent({
      system: BROWSER_AGENT_SYSTEM,
      prompt: `Navigate to https://console.cloud.google.com

Find and select the project named "${projectName}".
1. Click the project selector button in the header
2. The project selector shows rows with project IDs in the "ID" column - find the row with "${projectName}"
3. Click that row to select it

Return ONLY the project ID string (e.g., "my-project-123"), nothing else.`,
      capabilities: { raw: api, dts: apiDts },
      maxTurns: 10,
    })

    if (result.error || !result.result) {
      throw new Error(`Failed to find project: ${result.error ?? 'No project ID returned'}`)
    }

    this.log(`Project ID: ${result.result}`)
    return result.result
  }

  /**
   * Step 2: Enable Gmail API for a project
   */
  @tool(z.object({ projectId: z.string() }))
  async enableGmailApi({ projectId }: { projectId: string }): Promise<boolean> {
    const browser = this.getBrowser()
    const api = new SubagentApi(browser, this.log)
    const apiDts = await api.dts()

    this.log(`Enabling Gmail API for project "${projectId}"...`)

    // Pre-navigate to the Gmail API page
    await browser.navigate({ url: `https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=${projectId}` })

    const result = await this.subagent({
      system: BROWSER_AGENT_SYSTEM,
      prompt: `You are on the Gmail API page for project "${projectId}".

Take a snapshot to see the current state.
- If the API is already enabled, you'll see "API enabled" or a "Manage" button
- If not enabled, click the "Enable" button

Return "enabled" if the API is now enabled, or "already_enabled" if it was already enabled.`,
      capabilities: { raw: api, dts: apiDts },
      maxTurns: 5,
    })

    const enabled = result.result === 'enabled' || result.result === 'already_enabled'
    this.log(`Gmail API enabled: ${enabled}`)
    return enabled
  }

  /**
   * Step 3: Configure OAuth consent screen (ensures consent is set up, doesn't modify existing)
   */
  @tool(z.object({ projectId: z.string(), appName: z.string(), supportEmail: z.string() }))
  async configureOAuthConsent({ projectId, appName, supportEmail }: { projectId: string; appName: string; supportEmail: string }): Promise<boolean> {
    const browser = this.getBrowser()
    const api = new SubagentApi(browser, this.log)
    const apiDts = await api.dts()

    this.log(`Checking OAuth consent screen for project "${projectId}"...`)

    // Pre-navigate to the Branding page directly
    await browser.navigate({ url: `https://console.cloud.google.com/auth/branding?project=${projectId}` })

    const result = await this.subagent({
      system: BROWSER_AGENT_SYSTEM,
      prompt: `You are on the OAuth Branding page for project "${projectId}".

Take a snapshot to see the current state.

- If you see a form with "App name" field that has a value, OAuth consent is already configured. Return "already_configured".
- If the App name field is empty or you see a page asking to "Get started" or configure consent:
  1. Fill in App name: "${appName}"
  2. Fill in User support email: "${supportEmail}"
  3. Fill in Developer contact email: "${supportEmail}"
  4. Click Save
  5. Return "configured"

Do NOT modify existing settings. Only fill in if not yet configured.`,
      capabilities: { raw: api, dts: apiDts },
      maxTurns: 15,
    })

    const configured = result.result === 'configured' || result.result === 'already_configured'
    this.log(`OAuth consent configured: ${configured}`)
    return configured
  }

  /**
   * Step 4: Create OAuth client (without secret)
   */
  @tool(z.object({ projectId: z.string(), clientName: z.string() }))
  async createOAuthClient({ projectId, clientName }: { projectId: string; clientName: string }): Promise<string | null> {
    const browser = this.getBrowser()
    const api = new SubagentApi(browser, this.log)
    const apiDts = await api.dts()

    this.log(`Creating OAuth client for project "${projectId}"...`)

    // Pre-navigate directly to the create OAuth client page
    await browser.navigate({ url: `https://console.cloud.google.com/auth/clients/create?project=${projectId}` })

    const result = await this.subagent({
      system: BROWSER_AGENT_SYSTEM,
      prompt: `You are on the Create OAuth client page for project "${projectId}".

1. Take a snapshot to see the form
2. Select "Desktop app" for Application type (if not already selected)
3. Clear the Name field and enter "${clientName}" using fillByLabel({ label: 'Name', text: '${clientName}' })
4. Click the "Create" button
5. After creation, you'll be redirected to the client details page - the URL will contain the client ID

Return ONLY the client ID (e.g., "123456789-abc.apps.googleusercontent.com")`,
      capabilities: { raw: api, dts: apiDts },
      maxTurns: 10,
    })

    if (!result.result) {
      this.log(`Failed to create OAuth client: ${result.error ?? 'No client ID returned'}`)
      return null
    }

    this.log(`OAuth client created: ${result.result.substring(0, 30)}...`)
    return result.result
  }

  /**
   * Step 5: Create a client secret for an existing OAuth client
   */
  @tool(z.object({ projectId: z.string(), clientName: z.string() }))
  async createClientSecret({ projectId, clientName }: { projectId: string; clientName: string }): Promise<string | null> {
    const browser = this.getBrowser()
    const api = new SubagentApi(browser, this.log)
    const apiDts = await api.dts()

    this.log(`Creating secret for OAuth client "${clientName}"...`)

    await browser.navigate({ url: `https://console.cloud.google.com/auth/clients?project=${projectId}` })

    const result = await this.subagent({
      system: BROWSER_AGENT_SYSTEM,
      prompt: `Create a new client secret for the OAuth client named "${clientName}" and return the secret value.

1. Click on the client row with name "${clientName}"
2. Look for "Information and summary" button in the top right to expand a side panel
3. In the panel, find the "Client secrets" section
4. If "Add client secret" button is disabled, it means max secrets reached - return "max_secrets_reached"
5. Otherwise click "Add client secret", copy the secret value, and return it

Return either the secret value or "max_secrets_reached".`,
      capabilities: { raw: api, dts: apiDts },
      maxTurns: 15,
    })

    if (result.result === 'max_secrets_reached') {
      this.log(`Cannot create client secret: maximum number of secrets already exists`)
      return null
    }

    if (!result.result) {
      this.log(`Failed to create client secret: ${result.error ?? 'No secret returned'}`)
      return null
    }

    this.log(`Client secret created: ${result.result.substring(0, 10)}...`)
    return result.result
  }

  /**
   * Full setup flow - runs all steps
   */
  @tool(z.object({ projectName: z.string(), appName: z.string().optional(), supportEmail: z.string().optional() }))
  async setupGmail({ projectName, appName = 'Exoagent', supportEmail = 'test@example.com' }: { projectName: string; appName?: string; supportEmail?: string }): Promise<{
    projectId: string
    gmailApiEnabled: boolean
    oauthConfigured?: boolean
    oauthClient?: { clientId: string; clientSecret: string }
  }> {
    // Step 1: Get project ID
    const projectId = await this.getProjectId({ projectName })

    // Step 2: Enable Gmail API
    const gmailApiEnabled = await this.enableGmailApi({ projectId })

    return { projectId, gmailApiEnabled }
  }
}
