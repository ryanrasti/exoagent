import { BrowserClient } from './src/plugins/browser/index'
import { runSubagent } from './src/plugins/subagent/index'

async function main() {
  console.log('Testing subagent with domain-sandboxed browser...')

  // Connect to existing Chrome on port 9222
  const browser = new BrowserClient()

  // Create a sandboxed browser for GCP
  const gcpBrowser = browser.withAllowedDomains(['console.cloud.google.com'])

  const result = await runSubagent({
    prompt: `Navigate to the Google Auth Platform overview.
Tell me:
1. Is OAuth already configured?
2. What is the project ID?
3. Are there any existing OAuth clients?`,
    caps: {
      browser: gcpBrowser,
    },
    maxTurns: 5,
    verbose: true,
  })

  console.log('\n=== Subagent Result ===')
  console.log('Success:', result.success)
  console.log('Turns:', result.turns)
  console.log('Result:', result.result)
  if (result.error) {
    console.log('Error:', result.error)
  }

  await browser.close()
}

main().catch(console.error)
