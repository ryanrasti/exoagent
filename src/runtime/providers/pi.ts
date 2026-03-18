import { SandboxCap, nixPathsFromEnv } from './sandbox'
import type { StorageCap } from './storage'
import type { Secrets } from './secrets'
import { ReviewCap } from './review'
import { generateCapDts } from '../dts'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  AgentSession,
  type AgentSessionEvent,
  AuthStorage,
  type BashOperations,
  createBashTool,
  createEditTool,
  type EditOperations,
  type ExtensionFactory,
  createReadTool,
  type ReadOperations,
  createWriteTool,
  type WriteOperations,
  DefaultResourceLoader,
  InteractiveMode,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { Agent as PiAgent } from "@mariozechner/pi-agent-core"
import type { Model } from '@mariozechner/pi-ai'
import { Type } from '@sinclair/typebox'
import { codemode } from '../../code-mode'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Pi provider — coding agent backed by pi SDK.
 *
 * Two modes:
 * - Background: pi.prompt("do something") → returns text
 * - Interactive: pi.session exposes the AgentSession for TUI attach
 *
 * Tools are scoped to the sandbox workspace. Extensions, skills, prompts,
 * and themes are disabled by default (locked down).
 */

/** Default pi agent dir (~/.pi/agent) */
function getAgentDir() {
  return join(homedir(), '.pi', 'agent')
}

export interface PiCapConfig {
  sandbox: SandboxCap
  /** Arbitrary capability objects to expose via codemode */
  caps?: Record<string, object>
  /** Additional system prompt text */
  systemPrompt?: string
  /** Pre-generated .d.ts for caps (required when caps are provided) */
  capsDts: string
  /** Model override. Default: from settings/auth (normal pi behavior) */
  model?: Model<any>
  /** Extension factories for provider registration (e.g. mock providers in tests) */
  extensionFactories?: ExtensionFactory[]
  /** Model registry override */
  modelRegistry?: ModelRegistry
  /** Settings manager override. Default: disk-backed (normal pi behavior) */
  settingsManager?: SettingsManager
  /** Session manager override. Default: disk-backed (normal pi behavior) */
  sessionManager?: SessionManager
}

export class PiCap {
  private config: PiCapConfig
  private session: AgentSession | null = null
  private modelFallbackMessage?: string

  constructor(config: PiCapConfig) {
    if (config.caps && Object.keys(config.caps).length > 0 && !config.capsDts) {
      throw new Error('capsDts is required when caps are provided')
    }
    this.config = config
  }

  // -- Scoped tool operations -----------------------------------------------

  private sandboxBashOps(): BashOperations {
    const sandbox = this.config.sandbox
    return {
      exec: async (command: string, _cwd: string, options: {
        onData: (data: Buffer) => void
        signal?: AbortSignal
        timeout?: number
        env?: NodeJS.ProcessEnv
      }) => {
        const result = await sandbox.exec({ command, timeout: options.timeout, env: options.env as Record<string, string>, signal: options.signal })
        if (result.stdout) {
          options.onData(Buffer.from(result.stdout))
        }
        if (result.stderr) {
          options.onData(Buffer.from(result.stderr))
        }
        return { exitCode: result.exitCode }
      },
    }
  }

  private scopedReadOps(): ReadOperations {
    const sandbox = this.config.sandbox
    return {
      readFile: async (p: string) => { sandbox.validatePath(p); return readFile(p) },
      access: async (p: string) => { sandbox.validatePath(p); await access(p, constants.R_OK) },
    }
  }

  private scopedWriteOps(): WriteOperations {
    const sandbox = this.config.sandbox
    return {
      writeFile: async (p: string, c: string) => { sandbox.validatePath(p); await writeFile(p, c) },
      mkdir: async (p: string) => { sandbox.validatePath(p); await mkdir(p, { recursive: true }) },
    }
  }

  private scopedEditOps(): EditOperations {
    const sandbox = this.config.sandbox
    return {
      readFile: async (p: string) => { sandbox.validatePath(p); return readFile(p) },
      writeFile: async (p: string, c: string) => { sandbox.validatePath(p); await writeFile(p, c) },
      access: async (p: string) => { sandbox.validatePath(p); await access(p, constants.R_OK | constants.W_OK) },
    }
  }

  // -- Codemode for arbitrary caps ------------------------------------------

  private async buildCodemodeTool(): Promise<ToolDefinition | null> {
    const { caps, capsDts } = this.config
    if (!caps || Object.keys(caps).length === 0) {
      return null
    }

    const cm = await codemode(caps, capsDts)

    return {
      name: 'codemode',
      label: 'Code Mode',
      description: cm.description,
      parameters: Type.Object({
        code: Type.String({ description: 'JavaScript code to execute' }),
      }),
      execute: async (_toolCallId: string, params: { code: string }, _signal: AbortSignal | undefined) => {
        const result = await cm.execute({ code: params.code }, {} as never)
        return {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
          details: {},
        }
      },
    }
  }

  // -- Session setup --------------------------------------------------------

  private async ensureSession(): Promise<AgentSession> {
    if (this.session) {
      return this.session
    }

    const workspace = this.config.sandbox.workspace
    const agentDir = getAgentDir()
    const authStorage = AuthStorage.create(join(agentDir, 'auth.json'))
    const modelRegistry = this.config.modelRegistry ?? new ModelRegistry(authStorage, join(agentDir, 'models.json'))
    const settingsManager = this.config.settingsManager ?? SettingsManager.create(workspace, agentDir)
    const sessionManager = this.config.sessionManager ?? SessionManager.create(workspace)

    // Resolve model — check config, then settings default, then first available
    // Model may be undefined — interactive mode handles /login + /model
    let model = this.config.model
    if (!model) {
      const defaultProvider = settingsManager.getDefaultProvider()
      const defaultModelId = settingsManager.getDefaultModel()
      if (defaultProvider && defaultModelId) {
        const found = modelRegistry.find(defaultProvider, defaultModelId)
        if (found && await modelRegistry.getApiKey(found)) {
          model = found
        }
      }
      if (!model) {
        for (const m of modelRegistry.getAvailable()) {
          if (await modelRegistry.getApiKey(m)) {
            model = m
            break
          }
        }
      }
    }
    if (!model) {
      this.modelFallbackMessage = 'No model available. Use /login to authenticate, then /model to select.'
    }

    // Resource loader — locked down: no extensions, skills, prompts, or themes
    const resourceLoader = new DefaultResourceLoader({
      cwd: workspace,
      agentDir,
      settingsManager,
      extensionFactories: this.config.extensionFactories,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      appendSystemPrompt: this.config.systemPrompt,
    })
    await resourceLoader.reload()

    // Custom tools (codemode for caps)
    const customTools: ToolDefinition[] = []
    const codemodeTool = await this.buildCodemodeTool()
    if (codemodeTool) {
      customTools.push(codemodeTool)
    }

    // Base tools with scoped operations — only difference from stock pi
    const baseTools: Record<string, any> = {
      read: createReadTool(workspace, { operations: this.scopedReadOps() }),
      bash: createBashTool(workspace, { operations: this.sandboxBashOps() }),
      edit: createEditTool(workspace, { operations: this.scopedEditOps() }),
      write: createWriteTool(workspace, { operations: this.scopedWriteOps() }),
    }

    const thinkingLevel = settingsManager.getDefaultThinkingLevel()
      ?? (model?.reasoning ? 'medium' : 'off')

    const agent = new PiAgent({
      initialState: {
        systemPrompt: '',
        model: model as any,
        thinkingLevel,
        tools: [],
      },
      steeringMode: settingsManager.getSteeringMode(),
      followUpMode: settingsManager.getFollowUpMode(),
      transport: settingsManager.getTransport(),
      thinkingBudgets: settingsManager.getThinkingBudgets(),
      getApiKey: async (provider) => {
        const p = provider ?? model!.provider
        const key = await modelRegistry.getApiKeyForProvider(p)
        if (!key) {
          throw new Error(`No API key for "${p}". Run pi /login or set the API key env var.`)
        }
        return key
      },
    })

    // Restore session if continuing
    const existing = sessionManager.buildSessionContext()
    if (existing.messages.length > 0) {
      agent.replaceMessages(existing.messages)
      // Restore model from session if available
      if (existing.model) {
        const restored = modelRegistry.find(existing.model.provider, existing.model.modelId)
        if (restored && await modelRegistry.getApiKey(restored)) {
          agent.state.model = restored
        }
      }
    }
    else if (model) {
      sessionManager.appendModelChange(model.provider, model.id)
      sessionManager.appendThinkingLevelChange(thinkingLevel)
    }

    this.session = new AgentSession({
      agent,
      sessionManager,
      settingsManager,
      cwd: workspace,
      resourceLoader,
      customTools,
      modelRegistry,
      initialActiveToolNames: Object.keys(baseTools),
      baseToolsOverride: baseTools,
    })

    return this.session
  }

  // -- Public API -----------------------------------------------------------

  /** Send a prompt and return the final text response (background mode) */
  async prompt(message: string): Promise<string> {
    const session = await this.ensureSession()

    let finalText = ''
    const unsub = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        finalText += event.assistantMessageEvent.delta
      }
    })

    await session.prompt(message)
    unsub()

    return finalText
  }

  /** Access the underlying session (for interactive TUI attach) */
  get currentSession(): AgentSession | null {
    return this.session
  }

  /** Initialize session without prompting (for interactive mode) */
  async init(): Promise<AgentSession> {
    return this.ensureSession()
  }

  /** Run pi's interactive TUI (handles /login, /model, etc.) */
  async runInteractive(options?: { initialMessage?: string }): Promise<void> {
    const session = await this.ensureSession()
    const interactive = new InteractiveMode(session, {
      modelFallbackMessage: this.modelFallbackMessage,
      initialMessage: options?.initialMessage,
    })
    await interactive.run()
  }

  /** Dispose the session */
  dispose(): void {
    this.session?.dispose()
    this.session = null
  }
}

// -- Agent spawning (merged from spawn.ts) ----------------------------------

const AGENT_SYSTEM_PROMPT = `
## Code Review Workflow

You have a \`codemode\` tool with access to a \`review\` API for GitHub PR-based code review.

When asked to make changes that should be reviewed:

1. Create a branch: \`git checkout -b <descriptive-branch-name>\`
2. Make your changes (edit files, run tests, etc.)
3. Commit: \`git add -A && git commit -m "<message>"\`
4. Open a PR: \`review.openPR({ branch: "<branch>", title: "<title>", body: "<description>" })\`
5. Tell the user the PR URL so they can review it on GitHub
6. When the user says they've reviewed, check it: \`review.getReviews({ pr: <number> })\`
7. If approved, you're done. If changes requested, address the feedback, commit, push, and call openPR again.

Important:
- The PR URL is a real GitHub URL — tell the user so they can review in their browser
- Do NOT block waiting for reviews — the user will tell you when they've reviewed
- getReviews returns the latest review + all comments (both inline and general)
- You can open multiple PRs for different changes (use different branch names)
- After addressing feedback: commit, then call openPR again to update the PR (it force-pushes)
- Remote branch names are auto-prefixed with \`exoagent-<agent>/\` — just use descriptive names
`.trim()

export interface SpawnAgentConfig {
  id: string
  repoDir: string
  dataDir: string
  storage: StorageCap
  secrets: Secrets
}

export interface Agent {
  readonly id: string
  readonly pi: PiCap
  readonly review: ReviewCap | undefined
  readonly cloneDir: string
}

/**
 * Spawn a coding agent — wires sandbox + review + pi together.
 * Creates a local clone, sets up sandbox and review caps, and returns
 * a fully configured Agent.
 */
export async function spawnAgent(config: SpawnAgentConfig): Promise<Agent> {
  const { id, repoDir, dataDir, storage, secrets } = config


  const nix = nixPathsFromEnv()
  const gitPath = process.env.EXOAGENT_NIX_GIT!
  const git = join(gitPath, 'bin', 'git')

  // Create local clone
  const clonesDir = join(dataDir, 'clones')
  await mkdir(clonesDir, { recursive: true })
  const cloneDir = join(clonesDir, id)
  try {
    execFileSync(git, ['rev-parse', '--git-dir'], { cwd: cloneDir })
    execFileSync(git, ['fetch', 'origin'], { cwd: cloneDir, timeout: 30000 })
  }
  catch {
    // Clone from local repo (fast, hardlinks objects)
    execFileSync(git, ['clone', '--local', repoDir, cloneDir])

    // Point origin to the real remote so push/fetch go to GitHub
    try {
      const remoteUrl = execFileSync(git, ['remote', 'get-url', 'origin'], {
        cwd: repoDir, encoding: 'utf-8',
      }).trim()
      execFileSync(git, ['-C', cloneDir, 'remote', 'set-url', 'origin', remoteUrl])
    }
    catch {
      // Main repo has no remote — keep local origin
    }
  }
  execFileSync(git, ['-C', cloneDir, 'config', 'user.name', 'agent'])
  execFileSync(git, ['-C', cloneDir, 'config', 'user.email', 'agent@localhost'])

  // Resolve repo from origin (if GitHub)
  let repo: string | null = null
  try {
    const originUrl = execFileSync(git, ['remote', 'get-url', 'origin'], {
      cwd: cloneDir, encoding: 'utf-8',
    }).trim()
    const repoMatch = originUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/)
    if (repoMatch) {
      repo = repoMatch[1]
    }
  }
  catch {
    // No origin remote
  }

  // Sandbox (workspace = the clone)
  const sandbox = new SandboxCap({
    nix,
    storage,
    sessionId: id,
    workspace: cloneDir,
  })

  // Review cap (GitHub-based, only if origin is GitHub)
  const caps: Record<string, object> = {}
  let capsDts: string | undefined

  if (repo) {
    const review = new ReviewCap({
      cloneDir,
      git: gitPath,
      secrets,
      repo,
      agentName: id,
    })
    caps.review = review

    const reviewDts = generateCapDts(join(import.meta.dirname!, 'review.ts'), 'ReviewCap')
    capsDts = `declare const review: ${reviewDts}`
  }

  // Pi (coding agent with sandbox + caps)
  const pi = new PiCap({
    sandbox,
    caps,
    capsDts: capsDts!,
    systemPrompt: AGENT_SYSTEM_PROMPT,
  })

  return { id, pi, review: caps.review as ReviewCap | undefined, cloneDir }
}
