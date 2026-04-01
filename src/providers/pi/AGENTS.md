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

And returns a handle to the running agent.

### Why a Factory?
An exo defines *what* an agent can do by choosing which caps to pass.
For example, an "engineer" exo might:
```ts
const agent = await pi.create({
  cwd: '/path/to/repo',
  tools: [readTool, bashTool, editTool, writeTool],
  customTools: [githubTool],
})
await agent.prompt("Review the latest PR and post comments")
```

The pi provider itself doesn't decide what caps the agent gets — the exo does.
Pi just handles the boilerplate of setting up the SDK session (auth, model selection,
session management, resource loading).

### Manifest Dependencies
- `ring0`: native imports — `@mariozechner/pi-coding-agent` SDK, `node-pty`, `node:path`, `node:os`

No `config` dependency for v0 — pi already manages its own API keys
via `~/.pi/agent/auth.json` and respects `ANTHROPIC_API_KEY` env var.

### UI: Per-Client xterm.js Sessions
The pi provider UI is **scoped per client** (per exo that uses it).

- The UI panel lists every active client as a clickable link
- Clicking a client opens an **xterm.js** terminal in the browser
- The terminal connects via **WebSocket** to a **PTY** running pi's `InteractiveMode`
- This gives you full access to pi's TUI: streaming responses, tool execution,
  model cycling, compaction, everything — no custom chat UI needed
- It's like `tmux attach` for agents

#### Architecture
```
Browser (xterm.js)
  ↕ WebSocket
Hono server (pi.localhost:3000/ws/:client)
  ↕ node-pty
pi InteractiveMode (full TUI in a PTY)
```

#### Why xterm.js + PTY?
- Pi's TUI is already feature-complete (ink-based rendering, tool display, etc.)
- Building a custom web chat UI would duplicate all of that work
- A PTY faithfully reproduces the terminal experience including colors, cursor,
  scrollback, and interactive input
- You can literally type into the agent from your browser (or phone via tunnel)

### Key SDK Entry Points
- `createAgentSession(options)` — creates session with defaults, discovers extensions/skills
- `InteractiveMode` — the full TUI mode that runs inside the PTY
- `AgentSession` — the session object with `.prompt()`, `.subscribe()`, `.dispose()`
- `createBashTool()`, `createReadTool()`, etc. — tool factories that accept custom operations
- `SessionManager.inMemory()` / `SessionManager.create(cwd)` — session persistence

### What the Provider Returns
```ts
{
  // Create a new pi agent for a client (exo)
  create(options: PiCreateOptions): Promise<PiAgent>

  // List active agents
  list(): { client: string, cwd: string, status: string }[]
}
```

Where `PiAgent` provides:
- `prompt(message)` — send a prompt, return the final text response (headless/background mode)
- `session` — access the underlying `AgentSession` for streaming/events
- `dispose()` — clean up the PTY and session

### Scoping
- `clientProvider(clientName)`: returns the factory itself (exos get full `create()`)
- `uiProvider(clients)`: returns the list of active clients + WebSocket attach capability

## Implementation Plan
1. `manifest.ts` — ring0 for pi SDK, node-pty, node:path, node:os
2. `index.ts` — factory that wraps `createAgentSession()` + manages PTYs per client
3. WebSocket endpoint in server.ts — `/ws/:client` on `pi.localhost`, pipes to PTY
4. `src/ui/pi/Panel.tsx` — lists active clients, clicking one opens xterm.js terminal
5. Test with a simple exo that creates an agent and prompts it

## Dependencies to Add
- `node-pty` — PTY spawning (native module)
- `@xterm/xterm` — terminal emulator for the browser
- `@xterm/addon-fit` — auto-resize xterm to container
- `@xterm/addon-web-links` — clickable URLs in terminal output
