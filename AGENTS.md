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

1. 🚧 **Exoeval as pi's single custom tool**
   - ✅ tsc --declaration in build pipeline emits `.d.ts` files
   - ✅ Pi reads `.d.ts` and passes to agent-worker as exoeval tool description
   - ✅ Agent-worker subprocess connects back via IPC (Unix domain socket)
   - ✅ IPC protocol: newline-delimited JSON with id/code/result/error
   - **OPEN**: capEval registration — the exo's BoundEval needs to be registered
     on the pi session so IPC tool calls can evaluate against it. Can't pass
     functions through exoEval. Solutions: (a) loader wires it up after exo init,
     (b) pi provider accepts capEval via direct call, (c) reconstruct on pi side.

2. ✅ **Inbox provider** (8 tests)
   - Durable SQLite-backed message queue with deliver/peek/ack/snooze/pending/count
   - Scoped per client (exo), agent key is `scope/agent`
   - All queue semantics tested including snooze, ordering, multi-agent isolation

3. ✅ **Linear provider** (5 tests)
   - GraphQL API: getViewer, listIssues, getIssue, createIssue, addComment, updateIssueState, listTeams, listStates
   - Config schema for API key with link to Linear settings
   - UI panel with connection status
   - Tests with mock fetch responses, error handling

4. ✅ **Matrix provider** (6 tests)
   - REST API: sendMessage, getMessages, whoami, listJoinedRooms
   - Config schema for homeserver URL, access token, room ID with setup instructions
   - UI panel with connection status
   - Tests with mock fetch responses, error handling

5. ✅ **PM exo**
   - Creates pi agent with github + linear + matrix cap types
   - Lives in `examples/team/src/exos/pm/`
   - Event subscriptions stubbed (TODO: wire when providers support onX callbacks)

6. ⏭️ **VM provider** (skipped)
   - Requires Krun runtime + Nix derivation for rootfs — significant native dependency
   - Can't unit test without actual VM runtime installed
   - Deferred until engineer agent use case is active

7. ⏭️ **Engineer exo** (skipped)
   - Depends on VM provider (#6)
   - Deferred until VM provider is implemented

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
