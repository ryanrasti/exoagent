# Pi Provider

## Purpose
The pi provider is a **factory** — it creates pi agent sessions with caller-supplied capabilities.
It is not meant to be consumed by other providers (like config or fetch are).
It is meant to be consumed by **exos** (agents/tasks).

## Design

### Factory Pattern
Unlike other providers that expose `@tool()` methods and `clientProvider()`/`uiProvider()`,
the pi provider exports a `create()` function that takes:
- A session ID (unique per task/PR/issue within the client)
- Custom tools / capabilities to give the agent (passed by the exo)
- Optional overrides (model, thinking level, etc.)

And returns a handle to the running agent.

### Why a Factory?
An exo defines *what* an agent can do by choosing which caps to pass.
For example, an "engineer" exo might:
```ts
const agent = await pi.create({
	sessionId: 'pr-123',
	tools: [readTool, bashTool, editTool, writeTool],
	customTools: [githubTool],
})
await agent.prompt('Review the latest PR and post comments')
```

The pi provider itself doesn't decide what caps the agent gets — the exo does.
Pi just handles the boilerplate of setting up the SDK session (auth, model selection,
session management, resource loading).

### Session Storage Convention
Each agent session gets a deterministic working directory:

```
<dataDir>/providers/pi/<client>/<sessionId>/
```

For example:
```
.exoagent/providers/pi/engineer/pr-123/
.exoagent/providers/pi/engineer/pr-456/
.exoagent/providers/pi/reviewer/issue-78/
```

This directory serves as both:
- **cwd** for the agent (file read/write/edit operations are scoped here)
- **session storage** (pi's `SessionManager` persists conversation history here)

On restart, calling `create()` with the same `(client, sessionId)` tuple resumes
the existing session via `SessionManager.continueRecent(cwd)`. Pi handles
persistence, branching, compaction — all of it.

Note: for v0, an attached human *could* use pi's `/resume` to switch sessions,
but the agent itself cannot (it's isolated by its tools). Good enough for now.

### Manifest Dependencies
- `ring0`: native imports — `@mariozechner/pi-coding-agent` SDK, `node-pty`, `node:path`, `node:os`

No `config` dependency for v0 — pi already manages its own API keys
via `~/.pi/agent/auth.json` and respects `ANTHROPIC_API_KEY` env var.

### UI: Per-Client xterm.js Sessions
The pi provider UI is **scoped per client** (per exo that uses it).

- The UI panel lists every active client as a clickable link
- Clicking a client opens an **xterm.js** terminal in the browser
- The terminal communicates via **long-poll exoRpc** — no WebSocket needed
- This gives you full access to pi's TUI: streaming responses, tool execution,
  model cycling, compaction, everything — no custom chat UI needed
- It's like `tmux attach` for agents

#### Transport: Long-Poll over exoRpc
xterm.js is transport-agnostic — it just exposes `write(data)` and `onData(cb)`.
We implement the transport using two `@tool()` methods:

- `input(client, sessionId, data)` — fire-and-forget POST for keystrokes
- `read(client, sessionId)` — long-poll that blocks until PTY has output, then returns it

The UI loop:
```ts
const poll = async () => {
	const data = await exoRpc(({ pi }) => pi.read(client, sessionId), { client, sessionId })
	term.write(data)
	poll() // immediately re-poll
}
poll()

term.onData(data =>
	exoRpc(({ pi }) => pi.input(client, sessionId, data), { client, sessionId, data })
)
```

Server-side, `read()` resolves the moment the PTY emits data (or batches a few ms).
Effectively SSE semantics over plain HTTP — one outstanding request at all times,
instant response when data arrives.

This keeps everything within exoRpc. No WebSocket, no custom Hono handlers,
the pi provider stays in SES like all other providers.

### Key SDK Entry Points
- `createAgentSession(options)` — creates session with defaults, discovers extensions/skills
- `InteractiveMode` — the full TUI mode that runs inside the PTY
- `AgentSession` — the session object with `.prompt()`, `.subscribe()`, `.dispose()`
- `createBashTool()`, `createReadTool()`, etc. — tool factories that accept custom operations
- `SessionManager.continueRecent(cwd)` — resume or create session scoped to cwd

### What the Provider Returns
```ts
{
  // Create (or resume) a pi agent for a client
  create(options: PiCreateOptions): Promise<PiAgent>

  // List active agents for this client
  list(): { sessionId: string, cwd: string, status: string }[]
}
```

Where `PiAgent` provides:
- `prompt(message)` — send a prompt, return the final text response (headless/background mode)
- `session` — access the underlying `AgentSession` for streaming/events
- `dispose()` — clean up the PTY and session

### Scoping
- `clientProvider(clientName)`: returns a scoped factory — `create()` auto-prefixes
  the cwd with `<dataDir>/providers/pi/<clientName>/`
- `uiProvider(clients)`: returns the list of all active sessions across clients +
  long-poll read/input capability

## Implementation Plan
1. `manifest.ts` — ring0 for pi SDK, node-pty, node:path, node:os
2. `index.ts` — factory that wraps `createAgentSession()` + manages PTYs per (client, sessionId)
3. `@tool()` methods: `create()`, `list()`, `input(client, sessionId, data)`, `read(client, sessionId)` (long-poll)
4. `src/ui/pi/Panel.tsx` — lists active sessions grouped by client, clicking one opens xterm.js terminal
5. Test with a minimal exo that creates an agent and prompts it

## Dependencies to Add
- `node-pty` — PTY spawning (native module)
- `@xterm/xterm` — terminal emulator for the browser
- `@xterm/addon-fit` — auto-resize xterm to container
