import type { BrowserClient } from '../browser'
import { GoogleProvider } from './index'

export interface SetupOptions {
  /** Browser client for automation (should be logged into Google) */
  browser: BrowserClient
  /** GCP project name (display name) */
  projectName: string
  /** GCP project ID (optional - generated from name if not provided) */
  projectId?: string
  /** Test user email to add to OAuth consent screen */
  testUserEmail: string
  /** Whether to log progress */
  verbose?: boolean
}

/**
 * Generate a valid GCP project ID from a project name.
 * Project IDs must be 6-30 chars, lowercase letters, digits, hyphens.
 */
function generateProjectId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)

  // Add random suffix to ensure uniqueness
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base}-${suffix}`
}

export interface SetupResult {
  projectId: string
  credentialsStored: boolean
  tokensStored: boolean
  gmailWorking: boolean
}

/**
 * Full Gmail setup flow (pure browser automation):
 * 1. Create GCP project (if needed)
 * 2. Enable Gmail API
 * 3. Setup OAuth consent screen
 * 4. Create OAuth credentials
 * 5. Run OAuth flow
 * 6. Verify Gmail access
 */
export async function setupGmail(options: SetupOptions): Promise<SetupResult> {
  const { browser, projectName, testUserEmail, verbose = true } = options
  const projectId = options.projectId ?? generateProjectId(projectName)
  const log = verbose ? console.log.bind(console) : () => {}

  log(`Project name: ${projectName}`)
  log(`Project ID: ${projectId}`)

  const provider = new GoogleProvider(browser, projectId)

  // Step 1: Create GCP project via browser
  log('Step 1: Creating/selecting GCP project...')
  await createOrSelectProject(browser, projectId, projectName, log)

  // Step 2: Enable Gmail API via browser
  log('Step 2: Enabling Gmail API...')
  await enableGmailApi(browser, projectId, log)

  // Step 3: Check if credentials already exist
  log('Step 3: Checking for existing credentials...')
  const hasCredentials = await provider.hasCredentials()

  if (!hasCredentials) {
    // Step 4: Setup OAuth consent screen & create credentials via browser
    log('Step 4: Setting up OAuth consent screen...')
    await setupOAuthConsentScreen(browser, projectId, testUserEmail, log)

    log('Step 5: Creating OAuth credentials...')
    const credentials = await createOAuthCredentials(browser, projectId, log)
    await provider.setCredentials(JSON.stringify({ installed: credentials }))
    log('Credentials stored')
  } else {
    log('Credentials already exist, skipping OAuth setup')
  }

  // Step 6: Check if tokens exist, run OAuth flow if needed
  log('Step 6: Checking for existing tokens...')
  const hasTokens = await provider.hasTokens()

  if (!hasTokens) {
    log('Running OAuth flow to get tokens...')
    // This will trigger the OAuth flow via browser
    await provider.getAuth(['https://www.googleapis.com/auth/gmail.readonly'])
    log('Tokens stored')
  } else {
    log('Tokens already exist')
  }

  // Step 7: Verify Gmail works
  log('Step 7: Verifying Gmail access...')
  let gmailWorking = false
  try {
    const gmail = await provider.gmail()
    const messages = await gmail.list({ maxResults: 1, query: '' })
    gmailWorking = true
    log(`Gmail working! Found ${messages.length} messages`)
  } catch (err) {
    log(`Gmail verification failed: ${err}`)
  }

  return {
    projectId,
    credentialsStored: await provider.hasCredentials(),
    tokensStored: await provider.hasTokens(),
    gmailWorking,
  }
}

// --- Browser automation helpers for GCP setup ---

type LogFn = (...args: unknown[]) => void

async function createOrSelectProject(
  browser: BrowserClient,
  projectId: string,
  projectName: string,
  log: LogFn,
): Promise<void> {
  // Navigate to project selector
  await browser.navigate({ url: 'https://console.cloud.google.com/projectcreate' })
  await sleep(2000)

  const snap = await browser.snapshot()

  // Check if we need to create or if project exists
  // Try to fill in the project details
  try {
    await browser.fillByLabel({ label: 'Project name', text: projectName })
    await sleep(500)

    // The project ID field - need to edit it
    // Click "Edit" next to project ID if available
    try {
      await browser.clickRole({ role: 'button', name: 'Edit' })
      await sleep(500)
      await browser.fillByLabel({ label: 'Project ID', text: projectId })
    } catch {
      // Project ID might auto-generate, that's ok
      log('Could not set custom project ID, using auto-generated')
    }

    await sleep(500)
    await browser.clickRole({ role: 'button', name: 'Create' })
    await sleep(3000)
    log(`Project created: ${projectName}`)
  } catch (err) {
    // Project might already exist or creation failed
    log(`Project creation skipped (may already exist): ${err}`)
  }

  // Navigate to the project to ensure it's selected
  await browser.navigate({ url: `https://console.cloud.google.com/home/dashboard?project=${projectId}` })
  await sleep(2000)
}

async function enableGmailApi(
  browser: BrowserClient,
  projectId: string,
  log: LogFn,
): Promise<void> {
  // Navigate directly to Gmail API page
  await browser.navigate({
    url: `https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=${projectId}`,
  })
  await sleep(2000)

  const snap = await browser.snapshot()

  // Check if already enabled
  if (snap.includes('API enabled') || snap.includes('Manage')) {
    log('Gmail API already enabled')
    return
  }

  // Click Enable button
  try {
    await browser.clickRole({ role: 'button', name: 'Enable' })
    await sleep(3000)
    log('Gmail API enabled')
  } catch (err) {
    log(`Could not enable Gmail API (may already be enabled): ${err}`)
  }
}

// --- Browser automation helpers for new Google Auth Platform UI ---

async function setupOAuthConsentScreen(
  browser: BrowserClient,
  projectId: string,
  testUserEmail: string,
  log: LogFn,
): Promise<void> {
  // Navigate to Google Auth Platform overview
  await browser.navigate({
    url: `https://console.cloud.google.com/auth/overview?project=${projectId}`,
  })
  await sleep(2000)

  let snap = await browser.snapshot()

  // Check if already configured
  if (snap.includes('Branding') && !snap.includes('not configured yet')) {
    log('OAuth already configured')
    // Just ensure test user exists
    await ensureTestUser(browser, projectId, testUserEmail, log)
    return
  }

  // Click "Get started" to begin configuration
  if (snap.includes('Get started')) {
    log('Starting OAuth configuration...')
    await browser.clickRole({ role: 'link', name: 'Get started' })
    await sleep(2000)
    snap = await browser.snapshot()
  }

  // The "Get started" page asks for app info
  // Fill in App name and user support email
  try {
    // App name field
    await browser.fillByLabel({ label: 'App name', text: `exoagent-${projectId}` })
    await sleep(500)

    // User support email - might be a dropdown/combobox
    try {
      await browser.clickRole({ role: 'combobox', name: 'User support email' })
      await sleep(500)
      // Select the test user email from dropdown
      await browser.clickRole({ role: 'option', name: testUserEmail })
    } catch {
      // Try as text field
      await browser.fillByLabel({ label: 'User support email', text: testUserEmail })
    }
    await sleep(500)

    // Audience type - select External
    try {
      await browser.clickRole({ role: 'radio', name: 'External' })
    } catch {
      // May not have this option
    }
    await sleep(500)

    // Contact email
    try {
      await browser.fillByLabel({ label: 'Contact email', text: testUserEmail })
    } catch {
      // May not exist
    }

    // Click Continue or Create
    try {
      await browser.clickRole({ role: 'button', name: 'Continue' })
    } catch {
      try {
        await browser.clickRole({ role: 'button', name: 'Create' })
      } catch {
        await browser.clickRole({ role: 'button', name: 'Save' })
      }
    }
    await sleep(2000)
    log('App branding configured')
  } catch (err) {
    log(`Branding setup: ${err}`)
  }

  // Add test user
  await ensureTestUser(browser, projectId, testUserEmail, log)
}

async function ensureTestUser(
  browser: BrowserClient,
  projectId: string,
  testUserEmail: string,
  log: LogFn,
): Promise<void> {
  // Navigate to Audience section
  await browser.navigate({
    url: `https://console.cloud.google.com/auth/audience?project=${projectId}`,
  })
  await sleep(2000)

  const snap = await browser.snapshot()

  // Look for Add users button
  try {
    await browser.clickRole({ role: 'button', name: 'Add users' })
    await sleep(1000)

    // Fill in email
    await browser.fillByLabel({ label: 'Email', text: testUserEmail })
    await sleep(500)

    // Click Add or Save
    try {
      await browser.clickRole({ role: 'button', name: 'Add' })
    } catch {
      await browser.clickRole({ role: 'button', name: 'Save' })
    }
    await sleep(1000)
    log(`Test user added: ${testUserEmail}`)
  } catch (err) {
    log(`Test user may already exist: ${err}`)
  }
}

async function createOAuthCredentials(
  browser: BrowserClient,
  projectId: string,
  log: LogFn,
): Promise<{ client_id: string; client_secret: string; project_id: string }> {
  // Navigate to Clients page in new Auth Platform
  await browser.navigate({
    url: `https://console.cloud.google.com/auth/clients?project=${projectId}`,
  })
  await sleep(2000)

  log('Creating OAuth client...')

  // Click Create Client
  await browser.clickRole({ role: 'button', name: 'Create client' })
  await sleep(1000)

  // Select Desktop app as application type
  try {
    await browser.clickRole({ role: 'combobox', name: 'Application type' })
    await sleep(500)
    await browser.clickRole({ role: 'option', name: 'Desktop app' })
  } catch {
    // May have different UI
    log('Trying alternate UI for app type selection...')
  }
  await sleep(500)

  // Set name and create
  try {
    await browser.fillByLabel({ label: 'Name', text: `exoagent-${projectId}-desktop` })
  } catch {
    // Name field might have different label
  }
  await browser.clickRole({ role: 'button', name: 'Create' })
  await sleep(2000)

  // Extract credentials from the modal/page
  const content = await browser.content()

  // Parse client_id and client_secret from the page
  const clientIdMatch = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/)
  const clientSecretMatch = content.match(/GOCSPX-[a-zA-Z0-9_-]+/)

  if (!clientIdMatch || !clientSecretMatch) {
    throw new Error('Could not extract OAuth credentials from page')
  }

  log(`OAuth client created: ${clientIdMatch[1].slice(0, 20)}...`)

  // Close the modal if present
  try {
    await browser.clickRole({ role: 'button', name: 'OK' })
  } catch {
    try {
      await browser.clickRole({ role: 'button', name: 'Close' })
    } catch {
      // Modal may have closed
    }
  }

  return {
    client_id: clientIdMatch[1],
    client_secret: clientSecretMatch[0],
    project_id: projectId,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
