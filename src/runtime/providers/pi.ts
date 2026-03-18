import type { SandboxCap } from './sandbox'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import {
  AgentSession,
  type AgentSessionEvent,
  AuthStorage,
  type BashOperations,
  createBashTool,
  createEditTool,
  type EditOperations,
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
import { Agent } from '@mariozechner/pi-agent-core'
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
 * Tools are scoped to the sandbox workspace. Everything else (model,
 * sessions, settings, extensions) works like normal pi.
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
  /** Pre-generated .d.ts for caps (skips auto-generation from @tool metadata) */
  capsDts?: string
  /** Model override. Default: from settings/auth (normal pi behavior) */
  model?: Model<any>
  /** Resource loader override (for testing with mock providers, etc.) */
  resourceLoader?: InstanceType<typeof DefaultResourceLoader>
  /** Model registry override */
  modelRegistry?: ModelRegistry
  /** Settings manager override. Default: disk-backed (normal pi behavior) */
  settingsManager?: SettingsManager
  /** Session manager override. Default: disk-backed (normal pi behavior) */
  sessionManager?: SessionManager
}

export class PiCap {
  private config: PiCapConfig
  private _session: AgentSession | null = null
  private _modelFallbackMessage?: string

  constructor(config: PiCapConfig) {
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
        if (result.stdout)
          options.onData(Buffer.from(result.stdout))
        if (result.stderr)
          options.onData(Buffer.from(result.stderr))
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
    if (!caps || Object.keys(caps).length === 0)
      return null

    const cm = capsDts
      ? await codemode(caps, capsDts)
      : await codemode(caps as any)

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
    if (this._session)
      return this._session

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
        if (found && await modelRegistry.getApiKey(found))
          model = found
      }
      if (!model) {
        for (const m of modelRegistry.getAvailable()) {
          if (await modelRegistry.getApiKey(m)) { model = m; break }
        }
      }
    }
    if (!model)
      this._modelFallbackMessage = 'No model available. Use /login to authenticate, then /model to select.'

    // Resource loader — loads extensions, skills, prompts, themes from standard locations
    let resourceLoader = this.config.resourceLoader
    if (!resourceLoader) {
      resourceLoader = new DefaultResourceLoader({
        cwd: workspace,
        agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        appendSystemPrompt: this.config.systemPrompt,
      })
      await resourceLoader.reload()
    }

    // Custom tools (codemode for caps)
    const customTools: ToolDefinition[] = []
    const codemodeTool = await this.buildCodemodeTool()
    if (codemodeTool)
      customTools.push(codemodeTool)

    // Base tools with scoped operations — only difference from stock pi
    const baseTools: Record<string, any> = {
      read: createReadTool(workspace, { operations: this.scopedReadOps() }),
      bash: createBashTool(workspace, { operations: this.sandboxBashOps() }),
      edit: createEditTool(workspace, { operations: this.scopedEditOps() }),
      write: createWriteTool(workspace, { operations: this.scopedWriteOps() }),
    }

    const thinkingLevel = settingsManager.getDefaultThinkingLevel()
      ?? (model?.reasoning ? 'medium' : 'off')

    const agent = new Agent({
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
        if (!key)
          throw new Error(`No API key for "${p}". Run pi /login or set the API key env var.`)
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

    this._session = new AgentSession({
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

    return this._session
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
  get session(): AgentSession | null {
    return this._session
  }

  /** Initialize session without prompting (for interactive mode) */
  async init(): Promise<AgentSession> {
    return this.ensureSession()
  }

  /** Run pi's interactive TUI (handles /login, /model, etc.) */
  async runInteractive(options?: { initialMessage?: string }): Promise<void> {
    const session = await this.ensureSession()
    const interactive = new InteractiveMode(session, {
      modelFallbackMessage: this._modelFallbackMessage,
      initialMessage: options?.initialMessage,
    })
    await interactive.run()
  }

  /** Dispose the session */
  dispose(): void {
    this._session?.dispose()
    this._session = null
  }
}
