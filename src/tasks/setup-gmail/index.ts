import type { Caps } from '../../main'

const PROJECT_NAME = 'exoagent-personal'

export default async ({ browser, llm, log }: Caps) => {
  // Step 1: Go to project selector to find if our project exists
  await browser.navigate({ url: 'https://console.cloud.google.com/cloud-resource-manager' })
  log('Checking for existing project...')

  const listSnap = await browser.snapshot()
  const projectId = await llm.ask({
    system: 'If you find a project with the given name, return ONLY its project ID (not the display name). If not found, return ONLY the word "none". No other text.',
    prompt: `Find a project named "${PROJECT_NAME}" in this resource manager page.\n\n${listSnap}`,
  })
  log(`Project lookup result: ${projectId}`)

  const foundProjectId = projectId !== 'none' ? projectId : null

  if (foundProjectId) {
    log(`Project "${PROJECT_NAME}" exists with ID: ${foundProjectId}`)
  }

  if (foundProjectId === null) {
    // Create the project
    await browser.navigate({ url: 'https://console.cloud.google.com/projectcreate' })
    log('Creating project...')
    await browser.fillByLabel({ label: 'Project name', text: PROJECT_NAME })

    // Read the auto-generated project ID
    const createSnap = await browser.snapshot()
    const newProjectId = await llm.ask({
      system: 'Return ONLY the project ID shown on the page (like "beaming-storm-488708-v1"), nothing else.',
      prompt: `What is the Project ID shown on this project creation page?\n\n${createSnap}`,
    })
    log(`New project ID will be: ${newProjectId}`)

    await browser.clickRole({ role: 'button', name: 'Create' })
    log('Project creation initiated')

    // Wait for it
    await browser.snapshot()
    log('Project created')
  }

  // Use whichever project ID we have
  const pid = foundProjectId || 'exoagent-personal'
  log(`Using project ID: ${pid}`)

  // Step 2: Enable Gmail API
  await browser.navigate({ url: `https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=${pid}` })
  log('Navigated to Gmail API page')

  const apiSnap = await browser.snapshot()
  const apiStatus = await llm.ask({
    system: 'Answer with ONLY "enabled" or "not_enabled", nothing else.',
    prompt: `Is the Gmail API already enabled on this page (shows "Manage" or "API enabled") or not yet enabled (shows "Enable" button)?\n\n${apiSnap}`,
  })

  if (apiStatus === 'enabled') {
    log('Gmail API already enabled')
  }
  else {
    await browser.clickRole({ role: 'button', name: 'Enable' })
    log('Enabling Gmail API...')
    await browser.snapshot()
    log('Gmail API enabled')
  }

  // Step 3: OAuth consent screen
  await browser.navigate({ url: `https://console.cloud.google.com/apis/credentials/consent?project=${pid}` })
  log('Navigated to OAuth consent screen')

  const consentSnap = await browser.snapshot()
  const consentStatus = await llm.ask({
    system: 'Answer with ONLY "configured", "needs_user_type", or "needs_setup", nothing else.',
    prompt: `What is the state of the OAuth consent screen?\n- "configured" if it shows an already-configured app with edit buttons\n- "needs_user_type" if it shows Internal/External radio buttons\n- "needs_setup" if it shows something else\n\n${consentSnap}`,
  })
  log(`Consent screen status: ${consentStatus}`)

  if (consentStatus === 'needs_user_type') {
    await browser.clickRole({ role: 'radio', name: 'External' })
    await browser.clickRole({ role: 'button', name: 'Create' })
    log('Selected External user type')
  }

  if (consentStatus !== 'configured') {
    log('OAuth consent screen needs manual configuration — check the browser')
  }

  // Step 4: Create OAuth client
  await browser.navigate({ url: `https://console.cloud.google.com/apis/credentials?project=${pid}` })
  log('Navigated to credentials page')

  const credsSnap = await browser.snapshot()
  const hasClient = await llm.ask({
    system: 'Answer with ONLY "yes" or "no", nothing else.',
    prompt: `Does this credentials page show any existing OAuth 2.0 Client IDs?\n\n${credsSnap}`,
  })

  if (hasClient === 'yes') {
    log('OAuth client already exists')
  }
  else {
    log('Need to create OAuth client — check the browser')
  }

  log('Setup task complete')
}
