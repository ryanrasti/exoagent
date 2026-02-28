import type { Browser, BrowserContext, Page } from 'playwright'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { z } from 'zod'
import { tool } from '../../exoeval/tool'

const PROFILES_DIR = join(homedir(), '.exoagent', 'browser-profiles')

export interface BrowserClientOptions {
  /** Use an ephemeral profile that's cleaned up on close */
  ephemeral?: boolean
  /** Use a named persistent profile (stored in ~/.exoagent/browser-profiles/{name}) */
  profile?: string
  /** Connect to existing CDP endpoint instead of launching (default behavior if no other options) */
  cdpUrl?: string
  /** Port for Chrome debugging (default: finds free port) */
  port?: number
  /** Restrict navigation to these domains (e.g., ['console.cloud.google.com']) */
  allowedDomains?: string[]
}

async function findFreePort(): Promise<number> {
  const { createServer } = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('Failed to get port')))
      }
    })
    server.on('error', reject)
  })
}

async function findChromePath(): Promise<string> {
  // Check env var first
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH
  }

  // Platform-specific defaults
  if (process.platform === 'darwin') {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    for (const p of paths) {
      try {
        const { access } = await import('node:fs/promises')
        await access(p)
        return p
      } catch {
        // Try next
      }
    }
  }

  // Try common executable names
  const names = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']
  const { execSync } = await import('node:child_process')

  for (const name of names) {
    try {
      const path = execSync(`which ${name}`, { encoding: 'utf-8' }).trim()
      if (path) return path
    } catch {
      // Try next
    }
  }

  throw new Error('Could not find Chrome/Chromium. Set CHROME_PATH environment variable.')
}

async function waitForCDP(port: number, timeout = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Chrome CDP not ready after ${timeout}ms`)
}

/**
 * Check if a URL's host matches any of the allowed domains.
 * Supports exact match and subdomain match (e.g., 'google.com' matches 'console.cloud.google.com')
 */
function isAllowedDomain(url: string, allowedDomains: string[]): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    return allowedDomains.some((domain) => {
      const d = domain.toLowerCase()
      return host === d || host.endsWith(`.${d}`)
    })
  } catch {
    return false
  }
}

export class DomainBlockedError extends Error {
  constructor(
    public readonly attemptedUrl: string,
    public readonly allowedDomains: string[],
  ) {
    super(`Navigation blocked: ${attemptedUrl} is not in allowed domains: ${allowedDomains.join(', ')}`)
    this.name = 'DomainBlockedError'
  }
}

export class BrowserClient {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private chromeProcess: ChildProcess | null = null
  private tempProfileDir: string | null = null
  private port: number | null = null
  private domainEnforcementEnabled = false

  constructor(private options: BrowserClientOptions = {}) {}

  private async ensurePage(): Promise<Page> {
    if (!this.page) {
      await this.launch()
    }
    return this.page!
  }

  private async launch(): Promise<void> {
    const { ephemeral, profile, cdpUrl } = this.options

    // If connecting to existing CDP
    if (!ephemeral && !profile) {
      const url = cdpUrl || process.env.CDP_URL || 'http://localhost:9222'
      this.browser = await chromium.connectOverCDP(url)
      this.context = this.browser.contexts()[0]
      this.page = this.context?.pages()[0] ?? await this.context?.newPage() ?? null
      if (!this.page) {
        throw new Error(`No browser context found. Start Chrome with: google-chrome --remote-debugging-port=9222`)
      }
      return
    }

    // Launch Chrome with profile
    this.port = this.options.port ?? await findFreePort()

    let profileDir: string
    if (ephemeral) {
      // Create temp directory for ephemeral profile
      const { mkdtemp } = await import('node:fs/promises')
      const { tmpdir } = await import('node:os')
      profileDir = await mkdtemp(join(tmpdir(), 'chrome-exoagent-'))
      this.tempProfileDir = profileDir
    } else if (profile) {
      // Use persistent profile directory
      profileDir = join(PROFILES_DIR, profile)
      await mkdir(profileDir, { recursive: true })
    } else {
      throw new Error('Must specify ephemeral or profile')
    }

    // Find Chrome executable
    const chromePath = await findChromePath()

    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ]

    // Clear LD_LIBRARY_PATH to avoid NixOS conflicts
    const env = { ...process.env }
    delete env.LD_LIBRARY_PATH

    this.chromeProcess = spawn(chromePath, args, {
      env,
      detached: false,
      stdio: 'ignore',
    })

    this.chromeProcess.on('error', (err) => {
      console.error('Chrome process error:', err)
    })

    // Wait for CDP to be ready
    await waitForCDP(this.port)

    // Connect via CDP
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`)
    this.context = this.browser.contexts()[0]
    this.page = this.context?.pages()[0] ?? await this.context?.newPage() ?? null

    if (!this.page) {
      throw new Error('Failed to get page after launching Chrome')
    }

    // Set up domain enforcement if configured
    await this.setupDomainEnforcement()
  }

  private async setupDomainEnforcement(): Promise<void> {
    const { allowedDomains } = this.options
    if (!allowedDomains || allowedDomains.length === 0 || !this.context) {
      return
    }

    this.domainEnforcementEnabled = true

    // Block document navigations at the request level (before they happen)
    await this.context.route('**/*', async (route, request) => {
      const url = request.url()

      // Only enforce on document (navigation) requests
      if (request.resourceType() === 'document') {
        if (!isAllowedDomain(url, allowedDomains)) {
          // Abort the navigation
          await route.abort('blockedbyclient')
          return
        }
      }

      // Allow everything else
      await route.continue()
    })

    // Also monitor new pages/tabs
    this.context.on('page', (page) => {
      page.on('framenavigated', async (frame) => {
        if (frame === page.mainFrame()) {
          const url = page.url()
          if (url !== 'about:blank' && !isAllowedDomain(url, allowedDomains)) {
            // Close pages that somehow navigated outside allowed domains
            await page.close()
          }
        }
      })
    })
  }

  @tool(z.object({ url: z.string() }))
  async navigate({ url }: { url: string }): Promise<{ title: string; url: string }> {
    // Pre-check domain before navigation attempt (gives clearer error)
    const { allowedDomains } = this.options
    if (allowedDomains && allowedDomains.length > 0 && !isAllowedDomain(url, allowedDomains)) {
      throw new DomainBlockedError(url, allowedDomains)
    }

    const page = await this.ensurePage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    return { title: await page.title(), url: page.url() }
  }

  @tool()
  async snapshot(): Promise<string> {
    const page = await this.ensurePage()
    await page.waitForTimeout(2000)
    const snap = await (page as any)._snapshotForAI()
    return snap.full as string
  }

  @tool(z.object({ selector: z.string() }))
  async click({ selector }: { selector: string }): Promise<{ clicked: string }> {
    const page = await this.ensurePage()
    await page.click(selector)
    return { clicked: selector }
  }

  @tool(z.object({ role: z.string(), name: z.string() }))
  async clickRole({ role, name }: { role: string, name: string }): Promise<{ clicked: string }> {
    const page = await this.ensurePage()
    await page.getByRole(role as any, { name }).click()
    return { clicked: `${role}:${name}` }
  }

  @tool(z.object({ selector: z.string(), text: z.string() }))
  async type({ selector, text }: { selector: string, text: string }): Promise<{ typed: string, into: string }> {
    const page = await this.ensurePage()
    await page.fill(selector, text)
    return { typed: text, into: selector }
  }

  @tool(z.object({ label: z.string(), text: z.string() }))
  async fillByLabel({ label, text }: { label: string, text: string }): Promise<{ typed: string, into: string }> {
    const page = await this.ensurePage()
    await page.getByLabel(label).fill(text)
    return { typed: text, into: label }
  }

  @tool(z.object({ key: z.string() }))
  async press({ key }: { key: string }): Promise<{ pressed: string }> {
    const page = await this.ensurePage()
    await page.keyboard.press(key)
    return { pressed: key }
  }

  @tool()
  async title(): Promise<string> {
    const page = await this.ensurePage()
    return await page.title()
  }

  @tool()
  async url(): Promise<string> {
    const page = await this.ensurePage()
    return page.url()
  }

  @tool()
  async content(): Promise<string> {
    const page = await this.ensurePage()
    return await page.content()
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.context = null
      this.page = null
    }

    if (this.chromeProcess) {
      this.chromeProcess.kill()
      this.chromeProcess = null
    }

    // Clean up temp profile for ephemeral sessions
    if (this.tempProfileDir) {
      try {
        const { rm } = await import('node:fs/promises')
        await rm(this.tempProfileDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
      this.tempProfileDir = null
    }
  }

  /** Get the CDP port (useful for debugging) */
  getPort(): number | null {
    return this.port
  }

  /** Get the profile directory path */
  getProfileDir(): string | null {
    if (this.options.profile) {
      return join(PROFILES_DIR, this.options.profile)
    }
    return this.tempProfileDir
  }

  /** Get the allowed domains (if domain enforcement is enabled) */
  getAllowedDomains(): string[] | undefined {
    return this.options.allowedDomains
  }

  /** Check if domain enforcement is enabled */
  isDomainEnforcementEnabled(): boolean {
    return this.domainEnforcementEnabled
  }

  /**
   * Generate TypeScript definitions for this capability.
   * Returns the source of this file for use in codemode.
   */
  async dts(): Promise<string> {
    const thisFile = fileURLToPath(import.meta.url)
    const content = await readFile(thisFile, 'utf-8')
    return content
  }

  /**
   * Create a new BrowserClient with attenuated domain restrictions.
   * The new domains must be a subset of current allowed domains (or any if none set).
   * This can only restrict further, never expand permissions.
   */
  withAllowedDomains(domains: string[]): BrowserClient {
    const currentDomains = this.options.allowedDomains

    // If current has restrictions, new domains must be subset
    let finalDomains: string[]
    if (currentDomains && currentDomains.length > 0) {
      // Only keep domains that are allowed by current restrictions
      finalDomains = domains.filter((newDomain) =>
        currentDomains.some((currentDomain) => {
          const nd = newDomain.toLowerCase()
          const cd = currentDomain.toLowerCase()
          // newDomain is allowed if it equals or is subdomain of currentDomain
          return nd === cd || nd.endsWith(`.${cd}`)
        }),
      )
      if (finalDomains.length === 0) {
        throw new Error(
          `Cannot attenuate: none of [${domains.join(', ')}] are subsets of [${currentDomains.join(', ')}]`,
        )
      }
    } else {
      // No current restrictions, accept the new ones
      finalDomains = domains
    }

    return new BrowserClient({
      ...this.options,
      allowedDomains: finalDomains,
    })
  }
}
