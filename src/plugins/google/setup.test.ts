import { describe, expect, it } from 'vitest'
import { BrowserClient } from '../browser'
import { Llm } from '../llm'
import { GoogleSetup } from './setup'

/**
 * Integration test for subagent-driven Gmail setup.
 *
 * Prerequisites:
 * - Chrome/Chromium installed
 * - Logged into a Google account in the test browser profile
 *
 * To run: GMAIL_SETUP_TEST=1 npm test -- src/plugins/google/setup.test.ts
 */

const TEST_PROJECT_NAME = 'Exoagent Test'
const RUN_TESTS = process.env.GMAIL_SETUP_TEST === '1'

describe.skipIf(!RUN_TESTS)('Gmail Setup Integration', () => {
  it('should ensure a GCP project exists and return project ID', async () => {
    const browser = new BrowserClient({ profile: 'gmail-setup-test' })
    const llm = new Llm()
    const setup = new GoogleSetup(
      () => browser,
      llm.subagent.bind(llm),
    )

    try {
      const result = await setup.setupGmail({
        projectName: TEST_PROJECT_NAME,
      })

      expect(result.projectId).toBeTruthy()
      expect(typeof result.projectId).toBe('string')
      console.log('Project ID:', result.projectId)
    } finally {
      await browser.close()
    }
  }, 120000)
})

describe('Gmail Setup Unit Tests', () => {
  it('should export GoogleSetup class', () => {
    expect(typeof GoogleSetup).toBe('function')
  })
})
