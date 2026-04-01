# Pi Provider

## Purpose
The pi provider is a **factory** — it creates pi agent sessions with caller-supplied capabilities.
It is not meant to be consumed by other providers (like config or fetch are).
It is meant to be consumed by **exos** (agents/tasks).

## Design

### Factory Pattern
Unlike other providers that expose `@tool()` methods and `clientProvider()`/`uiProvider()`,
the pi provider exports a `create()` function that takes:
- A working directory (cwd) for the agent
- Custom tools / capabilities to give the agent (passed by the exo)
- Optional overrides (model, thinking level, session persistence, etc.)

And returns a configured `AgentSession` from the pi SDK.

### Why a Factory?
An exo defines *what* an agent can do by choosing which caps to pass.
For example, an "engineer" exo might:
```ts
const agent = await pi.create({
  cwd: '/path/to/repo',
  tools: [readTool, bashTool, editTool, writeTool],
  customTools: [githubTool, linearTool],
})
await agent.prompt("Review the latest PR and post comments")
```

The pi provider itself doesn't decide what caps the agent gets — the exo does.
Pi just handles the boilerplate of setting up the SDK session (auth, model selection,
session management, resource loading).

### Manifest Dependencies
- `ring0`: native imports — `@mariozechner/pi-coding-agent` SDK, `node:path`, `node:os`
- `config`: for storing/retrieving API keys (ANTHROPIC_API_KEY, etc.)

### Key SDK Entry Points
- `createAgentSession(options)` — high-level: creates session with defaults, discovers extensions/skills
- `AgentSession` — the session object with `.prompt()`, `.subscribe()`, `.dispose()`
- `createBashTool()`, `createReadTool()`, etc. — tool factories that accept custom operations
- `SessionManager.inMemory()` / `SessionManager.create(cwd)` — in-memory vs disk-backed sessions
- `SettingsManager`, `ModelRegistry`, `AuthStorage` — standard pi config infra

### Config Schema
The pi provider registers a config schema for API keys:
- `anthropic_api_key`: secret, required — the Anthropic API key for Claude models

### What the Provider Returns
```ts
{
  create(options: PiCreateOptions): Promise<PiAgent>
}
```

Where `PiAgent` wraps an `AgentSession` with:
- `prompt(message)` — send a prompt, return the final text response
- `session` — access the underlying `AgentSession` for streaming/events
- `dispose()` — clean up

### Scoping
- `clientProvider()`: returns the factory itself (exos get the full `create()`)
- `uiProvider()`: deferred — eventually a panel to see running agents, logs, etc.

## Implementation Plan
1. Create `manifest.ts` with ring0 (pi SDK + node:path + node:os) and config dependency
2. Create `index.ts` with the factory that wraps `createAgentSession()`
3. Wire API key retrieval through the config provider
4. Test with a simple exo that prompts the agent
