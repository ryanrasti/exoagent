import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserClient } from '../browser'
import { setupGmail } from './setup'

/**
 * Integration tests for Gmail setup flow.
 *
 * Prerequisites:
 * - Chrome/Chromium installed
 * - gcloud CLI installed and authenticated
 * - A Google account to use for testing
 *
 * These tests are marked with .skip by default since they require
 * real browser automation and Google account access.
 *
 * To run: GMAIL_SETUP_TEST=1 npm test -- src/plugins/google/setup.test.ts
 */

const TEST_PROJECT_NAME = 'Exoagent Test'
const TEST_PROJECT_ID = 'exoagent-test-' + Date.now().toString(36)
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'test@example.com'
const STORAGE_DIR = join(homedir(), '.exoagent', 'storage', `google-${TEST_PROJECT_ID}`)
const RUN_TESTS = process.env.GMAIL_SETUP_TEST === '1'

describe.skipIf(!RUN_TESTS)('Gmail Setup Integration', () => {
  let browser: BrowserClient

  beforeAll(async () => {
    // Use persistent profile so we can be logged into Google
    browser = new BrowserClient({ profile: 'gmail-setup-test' })
  }, 30000)

  afterAll(async () => {
    if (browser) {
      await browser.close()
    }
    // Clean up test storage
    try {
      await rm(STORAGE_DIR, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  })

  it('should complete full setup flow', async () => {
    const result = await setupGmail({
      browser,
      projectName: TEST_PROJECT_NAME,
      projectId: TEST_PROJECT_ID,
      testUserEmail: TEST_USER_EMAIL,
      verbose: true,
    })

    expect(result.projectId).toBe(TEST_PROJECT_ID)
    expect(result.credentialsStored).toBe(true)
    expect(result.tokensStored).toBe(true)
    expect(result.gmailWorking).toBe(true)
  }, 120000) // 2 minute timeout for full flow

  it('should be idempotent - second run skips completed steps', async () => {
    // Run setup again - should skip already-done steps
    const result = await setupGmail({
      browser,
      projectName: TEST_PROJECT_NAME,
      projectId: TEST_PROJECT_ID,
      testUserEmail: TEST_USER_EMAIL,
      verbose: true,
    })

    // Should still succeed
    expect(result.projectId).toBe(TEST_PROJECT_ID)
    expect(result.credentialsStored).toBe(true)
    expect(result.tokensStored).toBe(true)
    expect(result.gmailWorking).toBe(true)
  }, 60000) // Should be faster second time

  it('should handle existing project gracefully', async () => {
    // This tests that we don't fail if project already exists
    const result = await setupGmail({
      browser,
      projectName: TEST_PROJECT_NAME,
      projectId: TEST_PROJECT_ID,
      testUserEmail: TEST_USER_EMAIL,
      verbose: false,
    })

    expect(result.gmailWorking).toBe(true)
  }, 60000)
})

describe('Gmail Setup Unit Tests', () => {
  it('should export setupGmail function', () => {
    expect(typeof setupGmail).toBe('function')
  })
})
