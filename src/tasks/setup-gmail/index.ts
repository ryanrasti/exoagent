import type { Capabilities } from '../../capabilities'

const PROJECT_NAME = 'exoagent-personal'

// TODO: need an email to actually enable...
  // i.e., task itself needs to be parameterized

export default async ({ subagent, newBrowser, log }: Capabilities) => {
  // Step 1: Create the project if it doesn't exist
  const browser = newBrowser()
  const browserDts = await browser.dts()

  const createResult = await subagent({
    prompt: `Ensure a Google Cloud project named "${PROJECT_NAME}" exists. If not, create it. Return the project ID.`,
    capabilities: { raw: { browser }, dts: browserDts },
    options: ['projectId'],
  })
  if (!createResult.result) {
    log('Subagent failed to create project:', createResult.error)
    return
  }
  const projectId = createResult.result

  log(`Using project ID: ${projectId}`)

  // Step 2: Enable Gmail API
  const enableResult = await subagent({
    prompt: `Using the browser, enable the Gmail API for project ID "${projectId}".`,
    capabilities: { raw: { browser }, dts: browserDts },
  })

  if (enableResult.error) {
    log('Subagent failed to enable Gmail API:', enableResult.error)
    return
  }
  log('Gmail API enabled')

  // Step 3: Configure OAuth consent screen
  const consentResult = await subagent({
    prompt: `Configure the OAuth consent screen for project ID "${projectId}". Select "External" user type. You can use "Test App" for the app name and your email for the support email.`,
    capabilities: { raw: { browser }, dts: browserDts },
  })

  if (consentResult.error) {
    log('Subagent failed to configure OAuth consent screen:', consentResult.error)
    return
  }
  log('OAuth consent screen configured')

  // Step 4: Create OAuth client
  const clientResult = await subagent({
    prompt: `Create an OAuth 2.0 Client ID for a "Desktop app" in project ID "${projectId}".`,
    capabilities: { raw: { browser }, dts: browserDts },
  })

  if (clientResult.error) {
    log('Subagent failed to create OAuth client:', clientResult.error)
    return
  }

  // Step 5: Get OAuth credentials
  const credentialsResult = await subagent({
    prompt: `Get the OAuth credentials for the OAuth client created in project ID "${projectId}".`,
    capabilities: { raw: { browser }, dts: browserDts },
  })

  if (credentialsResult.error) {
    log('Subagent failed to get OAuth credentials:', credentialsResult.error)
    return
  }

  log('OAuth client created')

  log('Setup task complete')
}

// 1. Obtain oauth creds -> oauth.json
// const creds = setupGmail()
// 2. Run OAuth flow -> tokens
// const tokens = runOAuthFlow(creds)
// 3. Actually use apps
// const gmail = useGmail(tokens)

// -> almost as if we need to build a graph in case of failures, retries, etc.

// Maybe a different structure:
// const creds = ensureCredentials()
// const tokens = ensureTokens(creds)
// const gmail = useGmail(tokens)
// const calendar = useCalendar(tokens)

// if email doesn't exist -- task fails, agent monitors it -- auto-heals/prompts user
// if some step fails -- task fails, agent monitors it -- auto-heals with a --force or something for the right steps

// So minimal API:
// Setup:
// flow for credentials:
  // check
  // ensure
  // force
// flow for tokens:
  // check
  // ensure
  // force
// -> NEEDS OBSERVABILITY!!
//  simple version: just use `log` statements, feed them into the agent on failure

// Use:
  // flow for gmail -> calls ensureCredentials()


