import { BrowserClient } from './src/plugins/browser/index.ts'
import { setupGmail } from './src/plugins/google/setup.ts'

async function main() {
  console.log('Starting Gmail setup flow test...')

  const browser = new BrowserClient() // Connect to existing Chrome on port 9222

  try {
    const result = await setupGmail({
      browser,
      projectName: 'Exoagent Test',
      testUserEmail: 'ryan.mleone@gmail.com',
      verbose: true,
    })

    console.log('\n=== Setup Result ===')
    console.log('Project ID:', result.projectId)
    console.log('Credentials stored:', result.credentialsStored)
    console.log('Tokens stored:', result.tokensStored)
    console.log('Gmail working:', result.gmailWorking)
  } catch (err) {
    console.error('Setup failed:', err)
  }
}

main()
