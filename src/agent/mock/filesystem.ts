import { z } from 'zod'
import { ExoAgent } from '../../policy'

// ExoAgent for filesystem with file as both source and sink
// Using 'file' as the taint type, with path-based principals
export const fsExo = new ExoAgent(['file'] as const, ['file'] as const)

export interface FileInfo {
  path: string
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: Date
  principals: FilePrincipals
}

export interface FilePrincipals {
  /** The file path (used for path-based access control) */
  path: string
  /** Parent directory paths (for hierarchical permissions) */
  parentPaths: string[]
  /** Classification based on path patterns */
  classification: 'public' | 'internal' | 'confidential' | 'secret'
  /** All principals for this file */
  all: string[]
}

export interface FileContent {
  path: string
  content: string
  encoding: 'utf8' | 'base64'
  principals: FilePrincipals
}

/** Interface for filesystem operations */
export interface IFilesystem {
  list(opts: { path: string }): Promise<FileInfo[]>
  read(opts: { path: string }): Promise<FileContent>
  write(opts: { path: string, content: string }): Promise<{ success: boolean }>
  delete(opts: { path: string }): Promise<{ success: boolean }>
  copy(opts: { source: string, destination: string }): Promise<{ success: boolean }>
  move(opts: { source: string, destination: string }): Promise<{ success: boolean }>
}

/** Classify a path based on patterns */
function classifyPath(path: string): 'public' | 'internal' | 'confidential' | 'secret' {
  const lower = path.toLowerCase()
  if (lower.includes('/secret') || lower.includes('/.ssh') || lower.includes('/private')) {
    return 'secret'
  }
  if (lower.includes('/confidential') || lower.includes('/sensitive')) {
    return 'confidential'
  }
  if (lower.includes('/public') || lower.includes('/shared')) {
    return 'public'
  }
  return 'internal'
}

/** Get parent paths for hierarchical permissions */
function getParentPaths(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  const parents: string[] = []
  for (let i = 1; i < parts.length; i++) {
    parents.push('/' + parts.slice(0, i).join('/'))
  }
  return parents
}

/** Build principals for a path */
function buildPrincipals(path: string): FilePrincipals {
  const classification = classifyPath(path)
  const parentPaths = getParentPaths(path)
  return {
    path,
    parentPaths,
    classification,
    all: [path, ...parentPaths, classification],
  }
}

const listSchema = z.object({ path: z.string() })
const readSchema = z.object({ path: z.string() })
const writeSchema = z.object({ path: z.string(), content: z.string() })
const deleteSchema = z.object({ path: z.string() })
const copyMoveSchema = z.object({ source: z.string(), destination: z.string() })

/** Default seed data for mock filesystem */
export const MOCK_FS_SEED: Map<string, { content: string, isDirectory: boolean }> = new Map([
  ['/home/user', { content: '', isDirectory: true }],
  ['/home/user/documents', { content: '', isDirectory: true }],
  ['/home/user/documents/notes.txt', { content: 'My personal notes.', isDirectory: false }],
  ['/home/user/documents/todo.md', { content: '# TODO\n- Buy groceries\n- Call mom', isDirectory: false }],
  ['/home/user/public', { content: '', isDirectory: true }],
  ['/home/user/public/readme.txt', { content: 'This is public info.', isDirectory: false }],
  ['/home/user/confidential', { content: '', isDirectory: true }],
  ['/home/user/confidential/passwords.txt', { content: 'bank: hunter2\nemail: password123', isDirectory: false }],
  ['/home/user/confidential/tax-returns.pdf', { content: '[binary PDF content]', isDirectory: false }],
  ['/home/user/.ssh', { content: '', isDirectory: true }],
  ['/home/user/.ssh/id_rsa', { content: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...', isDirectory: false }],
  ['/home/user/.ssh/id_rsa.pub', { content: 'ssh-rsa AAAA... user@host', isDirectory: false }],
])

/** Mock filesystem client with in-memory state for testing */
export class MockFilesystemClient implements IFilesystem {
  private files: Map<string, { content: string, isDirectory: boolean, modifiedAt: Date }> = new Map()

  constructor(seedData: Map<string, { content: string, isDirectory: boolean }> = MOCK_FS_SEED) {
    this.seed(seedData)
  }

  /** Seed files for testing */
  seed(files: Map<string, { content: string, isDirectory: boolean }>): void {
    const now = new Date()
    for (const [path, data] of files) {
      this.files.set(path, { ...data, modifiedAt: now })
    }
  }

  /** Get current state for assertions */
  getState(): Map<string, { content: string, isDirectory: boolean }> {
    const state = new Map<string, { content: string, isDirectory: boolean }>()
    for (const [path, data] of this.files) {
      state.set(path, { content: data.content, isDirectory: data.isDirectory })
    }
    return state
  }

  /** Clear all state */
  clear(): void {
    this.files.clear()
  }

  @fsExo.tool(listSchema)
  async list({ path }: { path: string }): Promise<FileInfo[]> {
    const results: FileInfo[] = []
    const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path

    for (const [filePath, data] of this.files) {
      // Check if this file is a direct child of the requested path
      const parent = filePath.substring(0, filePath.lastIndexOf('/'))
      if (parent === normalizedPath) {
        const name = filePath.substring(filePath.lastIndexOf('/') + 1)
        results.push({
          path: filePath,
          name,
          isDirectory: data.isDirectory,
          size: data.content.length,
          modifiedAt: data.modifiedAt,
          principals: buildPrincipals(filePath),
        })
      }
    }
    return results
  }

  @fsExo.tool(readSchema, {
    source: (content: FileContent): ['file', { principals: string[] }] => [
      'file',
      { principals: content.principals.all },
    ],
  })
  async read({ path }: { path: string }): Promise<FileContent> {
    const file = this.files.get(path)
    if (!file) {
      throw new Error(`File not found: ${path}`)
    }
    if (file.isDirectory) {
      throw new Error(`Cannot read directory: ${path}`)
    }
    return {
      path,
      content: file.content,
      encoding: 'utf8',
      principals: buildPrincipals(path),
    }
  }

  @fsExo.tool(writeSchema, {
    sink: ({ path }: { path: string }): ['file', { principals: string[] }] => [
      'file',
      { principals: buildPrincipals(path).all },
    ],
  })
  async write({ path, content }: { path: string, content: string }): Promise<{ success: boolean }> {
    this.files.set(path, { content, isDirectory: false, modifiedAt: new Date() })
    return { success: true }
  }

  @fsExo.tool(deleteSchema, {
    sink: ({ path }: { path: string }): ['file', { principals: string[] }] => [
      'file',
      { principals: buildPrincipals(path).all },
    ],
  })
  async delete({ path }: { path: string }): Promise<{ success: boolean }> {
    const existed = this.files.delete(path)
    if (!existed) {
      throw new Error(`File not found: ${path}`)
    }
    return { success: true }
  }

  @fsExo.tool(copyMoveSchema, {
    // Copy reads from source and writes to destination
    // Source taint comes from the read, sink is the destination
    sink: ({ destination }: { source: string, destination: string }): ['file', { principals: string[] }] => [
      'file',
      { principals: buildPrincipals(destination).all },
    ],
  })
  async copy({ source, destination }: { source: string, destination: string }): Promise<{ success: boolean }> {
    const file = this.files.get(source)
    if (!file) {
      throw new Error(`Source file not found: ${source}`)
    }
    this.files.set(destination, { ...file, modifiedAt: new Date() })
    return { success: true }
  }

  @fsExo.tool(copyMoveSchema, {
    sink: ({ destination }: { source: string, destination: string }): ['file', { principals: string[] }] => [
      'file',
      { principals: buildPrincipals(destination).all },
    ],
  })
  async move({ source, destination }: { source: string, destination: string }): Promise<{ success: boolean }> {
    const file = this.files.get(source)
    if (!file) {
      throw new Error(`Source file not found: ${source}`)
    }
    this.files.set(destination, { ...file, modifiedAt: new Date() })
    this.files.delete(source)
    return { success: true }
  }
}
