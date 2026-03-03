import type { Caps } from '../../main'
import subagent from '../../plugins/subagent'

const PROJECT_NAME = 'exoagent-personal'

export default async ({ subagent, browser, log }: Caps) => {
  // Step 1: Create the project if it doesn't exist
  const createResult = await subagent({
    prompt: `Ensure a Google Cloud project named "${PROJECT_NAME}" exists. If not, create it. Return the project ID.`,
    caps: { browser },
    verbose: true,
  })

  if (!createResult.success) {
    log('Subagent failed to create project:', createResult.error)
    return
  }
  const projectId = createResult.result as string
  log(`Using project ID: ${projectId}`)

  // Step 2: Enable Gmail API
  const enableResult = await subagent({
    prompt: `Using the browser, enable the Gmail API for project ID "${projectId}".`,
    caps: { browser },
    verbose: true,
  })

  if (!enableResult.success) {
    log('Subagent failed to enable Gmail API:', enableResult.error)
    return
  }
  log('Gmail API enabled')

  // Step 3: Configure OAuth consent screen
  const consentResult = await subagent({
    prompt: `Configure the OAuth consent screen for project ID "${projectId}". Select "External" user type. You can use "Test App" for the app name and your email for the support email.`,
    caps: { browser },
    verbose: true,
  })

  if (!consentResult.success) {
    log('Subagent failed to configure OAuth consent screen:', consentResult.error)
    return
  }
  log('OAuth consent screen configured')

  // Step 4: Create OAuth client
  const clientResult = await subagent({
    prompt: `Create an OAuth 2.0 Client ID for a "Desktop app" in project ID "${projectId}".`,
    caps: { browser },
    verbose: true,
  })

  if (!clientResult.success) {
    log('Subagent failed to create OAuth client:', clientResult.error)
    return
  }
  log('OAuth client created')

  log('Setup task complete')
}

