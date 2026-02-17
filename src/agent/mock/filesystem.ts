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
  // Home directories
  ['/home/user', { content: '', isDirectory: true }],

  // Documents - general notes (workflow: web research → notes)
  ['/home/user/documents', { content: '', isDirectory: true }],
  ['/home/user/documents/notes.txt', { content: 'My personal notes.', isDirectory: false }],
  ['/home/user/documents/todo.md', { content: '# TODO\n- Review Q4 report for boss\n- Schedule meeting with Alice\n- Call mom about Sunday dinner\n- Prepare for ClientCorp call', isDirectory: false }],
  ['/home/user/documents/meeting-notes.md', { content: '# Meeting Notes\n\n## 2024-01-15 Team Standup\n- Alice: Working on auth PR\n- Bob: Fixed checkout bug\n- Discussed Friday deployment\n\n## 2024-01-14 1:1 with Alice\n- Project timeline looking good\n- Need to finalize Q1 roadmap', isDirectory: false }],

  // Research notes (workflow: web research → notes)
  ['/home/user/documents/research', { content: '', isDirectory: true }],
  ['/home/user/documents/research/ai-trends-2024.md', { content: '# AI Trends Research\n\n## Key Findings\n- LLM capabilities expanding rapidly\n- Agent frameworks emerging\n- Safety/alignment becoming critical\n\n## Sources\n- TechDigest newsletter\n- Industry reports', isDirectory: false }],
  ['/home/user/documents/research/competitor-analysis.md', { content: '# Competitor Analysis\n\n## Acme Corp\n- Revenue: ~$30M ARR\n- Team: 50 employees\n- Products: Widget platform\n\n## Beta Inc\n- Revenue: ~$20M ARR\n- Team: 35 employees\n- Products: Analytics suite', isDirectory: false }],

  // Downloads folder (workflow: file organization)
  ['/home/user/downloads', { content: '', isDirectory: true }],
  ['/home/user/downloads/Q4-Report-Draft.pdf', { content: '[PDF: Q4 Financial Report - DRAFT]', isDirectory: false }],
  ['/home/user/downloads/invoice-2024-001.pdf', { content: '[PDF: Invoice from Vendor XYZ - $1,500]', isDirectory: false }],
  ['/home/user/downloads/screenshot-2024-01-15.png', { content: '[PNG image data]', isDirectory: false }],
  ['/home/user/downloads/meeting-recording-2024-01-14.mp4', { content: '[MP4 video data]', isDirectory: false }],
  ['/home/user/downloads/random-file.txt', { content: 'Some random content from the web', isDirectory: false }],

  // Drafts folder (workflow: content publishing)
  ['/home/user/documents/drafts', { content: '', isDirectory: true }],
  ['/home/user/documents/drafts/blog-post-ai-agents.md', { content: '# The Future of AI Agents\n\n*Draft - Last edited Jan 15*\n\nAI agents are transforming how we work. In this post, we explore...\n\n## Key Points\n1. Automation of routine tasks\n2. Integration across tools\n3. Policy and safety considerations\n\n## Conclusion\nThe future is agentic.\n\n---\nTODO: Add examples, proofread', isDirectory: false }],
  ['/home/user/documents/drafts/client-proposal.md', { content: '# Proposal for ClientCorp\n\n## Executive Summary\nWe propose a 2-year partnership...\n\n## Pricing\n- Standard tier: $10k/month\n- Enterprise tier: $25k/month\n- 15% discount for 2-year commitment\n\n## SLA\n- 99.9% uptime guarantee\n- 24/7 support included\n\n---\nDRAFT - needs review', isDirectory: false }],

  // Public folder - shareable content
  ['/home/user/public', { content: '', isDirectory: true }],
  ['/home/user/public/readme.txt', { content: 'This is public info.', isDirectory: false }],
  ['/home/user/public/profile.md', { content: '# About Me\n\nSoftware engineer passionate about building great products.', isDirectory: false }],

  // Confidential folder
  ['/home/user/confidential', { content: '', isDirectory: true }],
  ['/home/user/confidential/passwords.txt', { content: 'bank: hunter2\nemail: password123', isDirectory: false }],
  ['/home/user/confidential/tax-returns-2023.pdf', { content: '[PDF: 2023 Tax Return - SSN: XXX-XX-1234]', isDirectory: false }],
  ['/home/user/confidential/salary-info.txt', { content: 'Base salary: $150,000\nBonus: 20%\nEquity: 10,000 options', isDirectory: false }],

  // SSH keys
  ['/home/user/.ssh', { content: '', isDirectory: true }],
  ['/home/user/.ssh/id_rsa', { content: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...PRIVATE_KEY_DATA...', isDirectory: false }],
  ['/home/user/.ssh/id_rsa.pub', { content: 'ssh-rsa AAAA... user@host', isDirectory: false }],

  // Work projects
  ['/home/user/projects', { content: '', isDirectory: true }],
  ['/home/user/projects/webapp', { content: '', isDirectory: true }],
  ['/home/user/projects/webapp/README.md', { content: '# WebApp\n\nOur main product webapp.\n\n## Setup\nnpm install\nnpm run dev', isDirectory: false }],
  ['/home/user/projects/webapp/.env', { content: 'DATABASE_URL=postgres://user:pass@localhost:5432/app\nAPI_KEY=sk-secret-key-12345\nSECRET_TOKEN=super-secret', isDirectory: false }],
])

/** Type definitions for LLM */
export const FILESYSTEM_DTS = `
interface FileInfo {
  path: string
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: Date
}

interface FileContent {
  path: string
  content: string
  encoding: 'utf8' | 'base64'
}

interface Filesystem {
  /** List files in a directory */
  list(opts: { path: string }): Promise<FileInfo[]>

  /** Read file content */
  read(opts: { path: string }): Promise<FileContent>

  /** Write content to a file */
  write(opts: { path: string, content: string }): Promise<{ success: boolean }>

  /** Delete a file */
  delete(opts: { path: string }): Promise<{ success: boolean }>

  /** Copy a file */
  copy(opts: { source: string, destination: string }): Promise<{ success: boolean }>

  /** Move a file */
  move(opts: { source: string, destination: string }): Promise<{ success: boolean }>
}
`

/** Mock filesystem client with in-memory state for testing */
export class MockFilesystemClient implements IFilesystem {
  static dts = FILESYSTEM_DTS
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
