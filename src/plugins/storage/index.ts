import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const STORAGE_ROOT = join(homedir(), '.exoagent', 'storage')
const VALID_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/

export class Storage<T extends Record<string, any>> {
  private dir: string

  constructor(namespace: string) {
    this.validateKey(namespace)
    this.dir = join(STORAGE_ROOT, namespace)
  }

  private validateKey(key: string): void {
    if (!VALID_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid key "${key}": must match [a-zA-Z0-9_-]+`)
    }
  }

  private filePath(key: string): string {
    this.validateKey(key)
    return join(this.dir, `${key}.json`)
  }

  async get<K extends keyof T & string>(key: K): Promise<T[K] | null> {
    try {
      const content = await readFile(this.filePath(key), 'utf-8')
      return JSON.parse(content) as T[K]
    }
    catch (err: any) {
      if (err.code === 'ENOENT') {
        return null
      }
      throw err
    }
  }

  async set<K extends keyof T & string>(key: K, value: T[K]): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.filePath(key), JSON.stringify(value, null, 2))
  }

  async delete<K extends keyof T & string>(key: K): Promise<void> {
    try {
      await rm(this.filePath(key))
    }
    catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err
      }
    }
  }

  async list(): Promise<(keyof T & string)[]> {
    try {
      const files = await readdir(this.dir)
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.slice(0, -5)) as (keyof T & string)[]
    }
    catch (err: any) {
      if (err.code === 'ENOENT') {
        return []
      }
      throw err
    }
  }
}
