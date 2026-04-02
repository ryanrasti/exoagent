## Project Phase

Pre-v1 rapid iteration. No deprecation warnings, no backwards compatibility
shims. Just fix and keep moving. Remove dead code, rename freely, break APIs.

## Workflow

Before committing or after a milestone, run `npm run check` (build + typecheck + tests).

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

## Core Primitive: Inbox

One built-in provider for agent communication:

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

Agent lifecycle (spawn/resume/attach) is already handled by the pi provider +
filesystem convention. No separate registry needed for v0:
- `pi.create(client, sessionId)` spawns or resumes via `SessionManager.continueRecent(cwd)`
- Pi provider's in-memory map tracks active sessions
- xterm.js UI lists and attaches to sessions

A registry will be needed when agents are spawned dynamically (e.g., one per
GitHub issue). The registry would persist which agents exist so they can be
re-spawned on daemon restart. Deferred until we have that use case.

### Why inbox

- **Decouples event sources from agents** — GitHub, Linear, Matrix all just
  `deliver()`. The agent doesn't care where messages came from.
- **Survives restarts** — durable SQLite queue, re-steer on boot.
- **No long-lived exo needed** — exo registers callbacks and exits.
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

Instructions: keep going until all planned tasks are completed. If a task has
unanticipated complexity, note it and skip. After done, put a summary after
each task with an emoji denoting status: ✅ done, ⏭️ skipped, 🚧 partial.

1. ✅ **Exoeval as pi's single custom tool**
   - Pi reads `.d.ts` and passes to agent-worker as exoeval tool description
   - Agent-worker subprocess connects back via IPC (Unix domain socket)
   - IPC protocol: newline-delimited JSON with id/code/result/error
   - capEval wired up via capEvalFactory set on pi by the loader after boot
   - Built-in tools (read/write/bash) disabled when caps provided

2. ✅ **Inbox provider** (8 tests)
   - Durable SQLite-backed message queue with deliver/peek/ack/snooze/pending/count

3. ❌ **Linear provider** — removed
   - GitHub Issues suffices for project tracking, one less integration to maintain

4. ✅ **Matrix provider** — E2EE rewrite
   - matrix-js-sdk with Rust crypto (Megolm/Olm) via ring0
   - Space-based workspace model (listRooms, createRoom, sendMessage, getMessages)
   - Room key persistence to `.exoagent/matrix/room-keys.json`
   - Proper logging: Tracing(LoggerLevel.Error) + loglevel silent + child logger patching
   - Config defaults (homeserver_url defaults to https://matrix.org)

5. ✅ **GitHub provider** — full REST API
   - 12 typed methods on shared `api()` helper: testConnection, getUser,
     listRepos, getRepo, listIssues, getIssue, createIssue, updateIssue,
     listComments, addComment, listPRs, getPR

6. ✅ **PM exo** — working agent with identity
   - Creates pi agent with github + matrix caps
   - System prompt: "You are Exo PM..."
   - Agent responds in character, can call GitHub and Matrix APIs

7. ✅ **BoundEval class** — composable capability container
   - `.run()`, `.map()` (attenuate), `.union()` (combine), `.capNames`
   - Replaces old `makeBoundEval` function API entirely

8. ✅ **exoeval CLI** — `npx tsx src/cli/exoeval.ts --caps matrix,github '<expr>'`
   - Boots only requested providers + transitive deps
   - One-shot and REPL modes

9. ✅ **ExoAgent class** + daemon smoke test
   - `start()/stop()/port/getProviders()` — clean lifecycle
   - Smoke test spawns daemon, verifies all core providers ready (~3s)

10. ✅ **Security hardening**
    - `harden()` ring0 results before passing to compartments
    - `import type` for BoundEval in providers (prevents acorn bundling → SES rejection)
    - `void` operator support in exoeval (esbuild compiles `undefined` to `void 0`)

11. ⏭️ **VM provider** — deferred until engineer agent use case

12. ⏭️ **Engineer exo** — depends on VM provider

## Next Steps

1. **Inbox as pi built-in** — every agent gets inbox automatically
   - Pi provider embeds inbox, exposes `pi.deliver(client, sessionId, msg)` send side
   - Agent gets `inbox` cap via `.union()` (peek/ack/snooze/pending)
   - Delete standalone inbox dep from exo manifests

2. **Matrix → inbox event loop** — real-time message delivery
   - `matrix.onMessage(roomId, callback)` using SDK sync events
   - Last-seen event ID tracking for restart catch-up
   - PM exo wires: `matrix.onMessage → pi.deliver`

3. **Inbox → steer** — wake agent when messages arrive
   - Pi watches inbox, writes to PTY stdin when new messages arrive
   - Messages inlined in steer (first 5, max 1k chars)
   - Heartbeat re-steers if messages remain unacked

4. **BoundEval.map() for real attenuation** — exos attenuate caps before passing to agents
   - PM exo: `exoEval.map({ github: g => ({ listIssues, createIssue, ... }) })`
   - Agent can't call methods the exo didn't grant
   - Wire `.d.ts` generation from attenuated types

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

## TODO

- **SES / exoeval / ring0 integration** — audit exactly how these 3 interact
  and the right mechanics (e.g., `harden`) for passing caps. Currently ring0
  results are hardened before passing to compartments, but need to verify:
  prototype chain isolation, whether compartment globals vs function args
  differ in taming, and that exoeval's AST-walking sandbox doesn't leak
  authority through cap object prototypes.

## Deferred

- **Git submodule tracking** — runtime repo tracks agent workdirs as submodules
- **IFC (Information Flow Control)** — exoeval provides the indirection layer
- **Tunnel / remote access** — Tailscale or Cloudflare, after local POC
- **Scoped caps per issue** — agent gets caps scoped to specific issue/PR (ocap actor model)
- **git worktree** — parallel agents on same repo
- **Agent budget/timeout** — per-agent token limits
