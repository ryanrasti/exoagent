## Coding Conventions

- Prefer `for (const x of y) {}` over `.forEach()`. Use `for...of` for all iteration.
- Prefer `{ [key: string]: T }` over `Record<string, T>`.
- Prefer `type` over `interface` for all type declarations.
- Prefer `const fn = () => {}` over `function fn() {}` for top-level and local functions.
- Use regular method syntax in classes (`foo() {}` not `foo = () => {}`).

## Open Design Questions

1. **Module namespacing vs UI routing.** Modules are namespaced by origin
   (`@exoagent/providers/pi`, `./exos/hello`, `<npm-pkg>/providers/foo`).
   Subdomains can't represent these (no `@` or `/` in DNS). Currently short names
   with collision = error. The right solution is probably **path-based routing with
   iframes** and `postMessage` as the only escape hatch. Server must set
   `X-Frame-Options` / CSP to prevent cross-origin framing (needs a test).

2. **Agent cwd.** Pi agents currently run in `.exoagent/providers/pi/<client>/<id>/`
   which is empty. Exos should be able to set cwd to an actual repo. Need to decide:
   does the exo pass an absolute path, or does pi clone/mount something?

## Build: .d.ts generation

The build pipeline emits `.d.ts` files for each provider via tsgo:

| Step       | Tool    | Input                        | Output                              |
|------------|---------|------------------------------|-------------------------------------|
| BE Bundles | esbuild | `src/providers/*/index.ts`   | `dist/providers/*/index.js`         |
| BE Types   | tsgo    | `src/providers/*/index.ts`   | `dist/providers/*/index.d.ts`       |
| Shared     | esbuild | `node_modules/zod/index.js`  | `dist/shared/zod.js`                |
| FE Assets  | Vite    | `src/ui/provider-mount.tsx`  | `dist/ui/`                          |

The `.d.ts` files serve a dual purpose:
1. **Type safety** for exos importing provider types
2. **LLM context** — pi reads `.d.ts` files and concatenates them into
   the exoeval tool description so the agent knows what caps are available

This is one of the main reasons for the separation between providers and the agent runtime.

## Core Primitives: Agent Registry + Inbox

Two built-in providers that every agent-based exo needs:

### Agent Registry (`@exoagent/providers/registry`)

Persistent registry of agents, scoped per exo client. Handles lifecycle:

- `getOrCreate(id)` — lookup or spawn a new pi agent
- Persists agent config to sqlite — survives daemon restart
- On daemon start, resumes all registered agents
- Each agent runs pi in interactive mode (attachable via xterm.js UI)

### Inbox (`@exoagent/providers/inbox`)

Durable message queue per agent. The interface between external events and agents:

- `agent.deliver(message)` — write to agent's inbox (exo/provider side)
- `inbox.peek()` — read oldest unacked, non-snoozed message (agent side)
- `inbox.ack(id)` — mark as handled
- `inbox.snooze(id, seconds)` — delay redelivery
- `inbox.pending()` — count of unacked, non-snoozed messages

Backed by SQLite. When a new message arrives, daemon steers the agent:
messages are inlined in the steer (first 5, max 1k chars) to avoid
a tool call round trip. Heartbeat re-steers if messages remain unacked.

### Why this architecture

- **Decouples event sources from agents** — GitHub, Linear, Matrix all just
  `deliver()`. The agent doesn't care where messages came from.
- **Survives restarts** — durable queue + registry resume agents on boot.
- **No long-lived exo needed** — the exo registers callbacks and exits.
  Providers own event loops, inbox owns the queue, daemon owns steering.
- **Handles agent being busy** — snooze, heartbeat, ack when done.
- **Path to ocap** — eventually caps arrive alongside inbox messages.

### Event source pattern

Providers with event sources (GitHub, Linear, Matrix) expose subscription methods.
The exo registers callbacks, then exits. Callbacks fire when events arrive:

```ts
export default async ({ exoEval }) => {
  // Create agent
  await exoEval(({ pi }) => pi.create('pm', 'main'))

  // Subscribe — callbacks close over all caps in the BoundEval scope
  await exoEval(({ linear, pi }) =>
    linear.onIssueCreated(issue =>
      pi.prompt(`New issue: ${issue.title}\n${issue.description}`)
    )
  )

  await exoEval(({ matrix, pi }) =>
    matrix.onMessage(msg =>
      pi.prompt(`Message from ${msg.sender}: ${msg.body}`)
    )
  )
}
```

## Next Steps (in order)

1. **Exoeval as pi's single custom tool**
   - Give pi ONE custom tool: `exoeval`
   - The tool is a BoundEval closure pre-bound to the exo's caps
   - Read `.d.ts` files from `dist/providers/*/index.d.ts`, concat into tool description
   - Wire up tsgo in the build pipeline to emit `.d.ts` files

2. **Agent registry + inbox providers**
   - Registry: persistent agent lifecycle, scoped per client
   - Inbox: durable message queue with ack/snooze/steer
   - Both backed by sqlite provider
   - Unit tests for registry CRUD and inbox queue semantics

3. **Linear provider**
   - @tool() methods: create/update/query issues (GraphQL API internally)
   - `onIssueCreated(callback)`, `onIssueUpdated(callback)` — polling-based
   - Config schema for API key
   - Manifest: depends on config + fetch (attenuated to `api.linear.app`)
   - Unit tests with mock fetch responses

4. **Matrix provider**
   - Use existing Matrix server (e.g., matrix.org) + private room/space
   - @tool() methods: sendMessage, onMessage (via `/sync` long-poll)
   - Config schema for homeserver URL, access token, room ID
   - Manifest: depends on config + fetch (attenuated to homeserver)
   - Unit tests with mock fetch responses
   - Leave space for setup instructions (register bot, grab token)

5. **PM exo**
   - Consumes: pi, registry, inbox, linear, matrix, github
   - Registers event callbacks, creates agent via registry
   - Linear/Matrix/GitHub events → inbox → daemon steers agent
   - Lives in `examples/team/src/exos/pm/`
   - Unit tests for routing logic

6. **VM provider** (for engineer agent)
   - Krun-based sandboxed execution
   - Nix derivation defines rootfs
   - Agent gets a `bash` cap that runs inside the VM
   - Unit tests with mock VM execution

7. **Engineer exo**
   - Consumes: pi, registry, inbox, github, vm
   - GitHub issue events → inbox → agent codes + opens PR
   - Agent works on branch (`issue-<number>/<desc>`), rebases on main
   - Lives in `examples/team/src/exos/engineer/`

## Implementation Notes

### Provider pattern for linear/matrix

Same as github:
```
src/providers/<name>/
  index.ts      # @tool() class with API methods
  manifest.ts   # { config: ..., fetch: ... }
  ui.tsx         # config panel
```

### Testing approach

- Provider unit tests: mock the BoundEval/exoEval to return canned responses
- Exo tests: mock provider instances, verify the exo calls the right caps
- Integration: daemon smoke test (existing)

### Agent communication detail

Daemon watches inboxes and steers agents when messages arrive:

```
Event source → provider.deliver(msg) → inbox (SQLite)
  → daemon sees new unacked message
  → daemon steers agent with messages inlined:

    "New messages in your inbox:

    1. [id:abc] [issue_comment] @ryan on #42 (2min ago):
       The tests are still failing on CI

    2. [id:def] [linear] Issue LIN-123 assigned to you:
       Fix login page redirect

    Use inbox.ack(id) when you've addressed each one."

  → agent acts, calls inbox.ack("abc"), inbox.ack("def")
```

Messages inlined in steer (first 5, max 1k chars) — zero tool calls to receive.
Agent can call `inbox.peek()` to re-read or check for more.
Heartbeat re-steers if messages remain unacked.

## Deferred

- **Git submodule tracking** — runtime repo tracks agent workdirs as submodules
- **IFC (Information Flow Control)** — exoeval provides the indirection layer
- **Tunnel / remote access** — Tailscale or Cloudflare, after local POC
- **Scoped caps per issue** — agent gets caps scoped to specific issue/PR (ocap actor model)
- **git worktree** — parallel agents on same repo
- **Agent budget/timeout** — per-agent token limits
