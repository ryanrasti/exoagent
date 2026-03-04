import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { tool } from './exoeval/tool'
import { BrowserClient } from './plugins/browser'
import { MockGmailClient } from './plugins/gmail'
import { Llm } from './plugins/llm'

type Resource = {
  close: () => Promise<void>
}

/**
 * Interface for capabilities that can generate TypeScript definitions
 */
export interface DtsCapability {
  dts(): Promise<string>
}

/**
 * Base helper to read a .ts file and return its contents as dts
 */
export async function readSourceAsDts(importMetaUrl: string): Promise<string> {
  const filePath = fileURLToPath(importMetaUrl)
  const content = await readFile(filePath, 'utf-8')
  return content
}

export class Capabilities {
  private resources: Resource[] = []

  @tool()
  public readonly gmail = new MockGmailClient()

  /**
   * Get a browser client connected to existing Chrome (via CDP_URL or localhost:9222)
   */
  @tool()
  public newBrowser(): BrowserClient {
    return this.register(new BrowserClient())
  }

  /**
   * Get a browser client with an ephemeral profile (cleaned up on close)
   */
  @tool()
  public newEphemeralBrowser(): BrowserClient {
    return this.register(new BrowserClient({ ephemeral: true }))
  }

  /**
   * Get a browser client with a named persistent profile.
   * Profile is stored in ~/.exoagent/browser-profiles/{name}
   * Useful for keeping login sessions across runs.
   */
  @tool(z.string())
  public newBrowserWithProfile(profile: string): BrowserClient {
    return this.register(new BrowserClient({ profile }))
  }

  @tool()
  public readonly llm = new Llm()

  @tool()
  public readonly subagent = this.llm.subagent

  constructor(public readonly task: string) {
    this.resources = []
  }

  register<T extends Resource>(resource: T): T {
    this.resources.push(resource)
    return resource
  }

  @tool(z.string())
  log(message: string, ...args: any[]) {
    console.log(message, ...args)
  }

  async close() {
    for (const resource of this.resources.reverse()) {
      try {
        await resource.close()
      } catch (err) {
        console.error(`error closing resource: ${resource}`, err)
      }
    }
  }

  /**
   * Generate TypeScript definitions for the given capability keys
   */
  async dts<K extends keyof Capabilities>(...keys: K[]): Promise<string> {
    const parts: string[] = []

    for (const key of keys) {
      const cap = this[key]
      if (cap && typeof cap === 'object' && 'dts' in cap && typeof cap.dts === 'function') {
        const capDts = await (cap as DtsCapability).dts()
        parts.push(`// <${key}>\n${capDts}`)
      }
    }

    // Add the Pick type for the API
    const pickKeys = keys.map((k) => `'${String(k)}'`).join(' | ')
    parts.push(`\n// <api>\nexport type Api = Pick<Capabilities, ${pickKeys}>`)

    return parts.join('\n\n')
  }
}
