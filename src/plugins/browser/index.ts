import { join } from 'node:path'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { z } from 'zod'
import { tool } from '../../exoeval/tool'

const USER_DATA_DIR = join(import.meta.dirname, '..', '..', '..', '.exoagent', 'browser-profile')

export class BrowserClient {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null

  private async ensurePage(): Promise<Page> {
    if (!this.page) {
      const cdpUrl = process.env.CDP_URL || 'http://localhost:9222'
      this.browser = await chromium.connectOverCDP(cdpUrl)
      this.context = this.browser.contexts()[0]
      this.page = this.context?.pages()[0] ?? await this.context?.newPage() ?? null
      if (!this.page) {
        throw new Error(`No browser context found. Start Chromium with: chromium --remote-debugging-port=9222`)
      }
    }
    return this.page
  }

  @tool(z.object({ url: z.string() }))
  async navigate({ url }: { url: string }): Promise<{ title: string, url: string }> {
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
  }
}
