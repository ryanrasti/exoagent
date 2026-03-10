# ExoAgent Runtime

## Workflow

Don't commit until we move on. The loop is: prompt → do → review → iterate →
commit once settled. No intermediate commits during iteration.

No skeletons or stubs. Don't write a file until it's actually used. No
placeholder providers, no empty composition roots, no "will be wired later"
code.

## Overview

**exoagentd** is a runtime daemon. It manages:

- **Exos** — sandboxed programs (like systemd units). Code runs in exoeval
  (sandboxed JS interpreter). Exos declare their caps by destructuring at
  the top of the file. They are the untrusted layer.
- **Providers** — capability classes. Their instantiations are caps. Providers
  run in the main daemon process (no sandbox) — they have access to secrets
  and the host. They are the trusted layer.

The **environment** layer (e.g., `dev.ts`) handles translating provider classes
into cap instances with the right config/secrets.

The system is **recursive and self-extending**:

1. The **init exo** is a coding agent. It hooks pi directly to stdin/stdout.
   The coding agent gets basic caps: `bash`, `read`, `write`, `edit` — these
   execute inside a bwrap sandbox via the sandbox provider.

2. The coding agent can **create, update, and delete custom providers and
   exos** — but all changes go through a **review cap**. The review cap
   pushes a branch and creates a code review (Forgejo). Once approved, code
   is merged and the daemon hot-reloads.

3. For now while we iterate, the agent can modify any part of the codebase.
   Later, a non-root mode rejects diffs outside a boundary.

4. The coding agent uses the system to keep building the system.

### Why This Works

- **Providers** = trusted code. Unsandboxed, hold secrets, make API calls.
  Either builtin or human-reviewed via the review cap.
- **Exos** = untrusted code. Run in exoeval. Can only call `@tool()`
  methods on destructured caps. Cannot import, access globals, or escape.
- **The review cap** = the escalation boundary. The agent proposes changes
  (branch + sha), a human reviews in Forgejo, approves or rejects. This is
  the root of trust.

**The agent cannot escalate its own privileges without human review.**

---

## Core Concepts

### Daemon (exoagentd)

The long-running host process. When you run `exoagentd`, the init exo starts
and pi connects directly to stdin/stdout — you're talking to the coding agent.

Responsibilities:
- Load and manage providers (trusted, unsandboxed)
- Load and execute exos (untrusted, in exoeval)
- Hold secrets
- Manage sandbox lifecycles (bwrap)
- Host pi sessions (SDK, LLM API keys)

### Providers

A provider is a class. Its instantiation is a cap. The environment layer
(`dev.ts`) wires classes to config/secrets.

```typescript
interface Provider {
  readonly name: string
  capabilities(): Record<string, object>  // @tool() decorated
  close?(): Promise<void>
}
```

Each provider has a string name — the top-level key in the root cap object.

**Builtin providers:**

- **sandbox** — bwrap-based execution environment. Provides `bash`, `read`,
  `write`, `edit` that run inside an isolated namespace. Also exposes
  `read`/`write` for pi's custom tools. Network filtered via slirp4netns
  (internet yes, LAN/host no). NixOS closure for root filesystem with rw
  overlay on /nix/store. Depends on storage for persistent sessions.
- **pi** — spawns pi sessions via SDK. Replaces pi's builtin tools with
  sandbox-backed versions (bash/read/write/edit). Manages session lifecycle.
  The init exo hooks pi directly to stdin/stdout.
- **review** — the escalation cap. `review.propose(branch, sha)` creates a
  code review in a local Forgejo instance. Returns approved/rejected. On
  approval, triggers daemon hot-reload.
- **storage** — persistent KV + directory management. Lives in `.exoagent/`
  inside the repo. Exposes both KV operations and raw directory access for
  mounts, session files, etc.
- **secrets** — special cap passed to each provider (except itself). Reads
  from `.exoagent/secrets.json`. Providers get their secrets by name.

**Custom providers** are created by the coding agent, reviewed in Forgejo,
and loaded by the daemon. They live in `src/runtime/providers/`.

### Exos

An exo is a sandboxed program. Caps are declared by destructuring:

```javascript
// src/runtime/exos/implement-issue.ts
export default async ({ linear, github, pi, review }) => {
  const issue = await linear.getIssue({ id: input.issueId })
  await pi.prompt(`Implement this: ${issue.title}\n${issue.description}`)
  await github.createPR({ ... })
  await linear.transition({ id: issue.id, status: 'in_review' })
}
```

Exos live in `src/runtime/exos/`. Only the destructured caps are available.
exoeval enforces this at the interpreter level.

**exoeval keeps its restricted syntax** (const-only, no for/while/try-catch).
This is intentional — it enables expression-based information flow control.
A custom eslint rule for the exos folder flags disallowed syntax with clear
error messages before exoeval rejects them at runtime.

### Secrets

A special cap. JSON file at `.exoagent/secrets.json`:

```json
{
  "github:work": {
    "token": "ghp_...",
    "owner": "acme-corp"
  },
  "github:personal": {
    "token": "ghp_...",
    "owner": "ryanrasti"
  },
  "linear": {
    "api_key": "lin_...",
    "team": "EXO"
  },
  "pi": {
    "anthropic_api_key": "sk-ant-..."
  }
}
```

Each provider receives its own secrets by name. The secrets cap is passed
to providers during construction — never to exos or sandboxes.

### The Review Cap

The review cap is the root of trust. The interface is minimal:

```javascript
const result = await review.propose(branch, sha)
// result.approved: boolean
// result.comments: [{ path, line, body }, ...]  — inline review comments
```

Under the hood:
1. The coding agent works on a branch, commits changes
2. `review.propose('feat/github-provider', 'abc123')` creates a PR in the
   local Forgejo instance
3. The user reviews in Forgejo's UI (inline comments, approve/reject)
4. Result returns to the agent — if rejected, includes comments so the agent
   can address feedback and re-propose
5. On approval, code is merged and the daemon hot-reloads

**Forgejo** is a single Go binary with a full code review UI. Runs locally.
Lighter than Gerrit. The repo is the Forgejo repo — no sync needed.

### Hot-Reload

When a review is approved and code is merged:

1. Provider is an npm package (can be local filesystem)
2. Rebuild (get the `.d.ts` for free)
3. Dynamic import of the new module
4. Replace the cap instance in the environment

For v0, this is a careful system of imports from the root cap. Long-term,
each provider runs in its own isolate and communicates over RPC — hot-reload
becomes repointing to a new RPC target.

---

## Bootstrapping

### Step 0: Start the daemon

```bash
exoagentd
```

Starts with builtin providers. The init exo spawns immediately. Pi connects
to stdin/stdout — you're talking to the coding agent.

### Step 1: Init exo

```javascript
// src/runtime/exos/init.ts
export default async ({ sandbox, review, storage, pi }) => {
  await pi.interactive({
    capabilities: { sandbox, review, storage },
    stdio: true,  // hook to stdin/stdout
  })
}
```

The human is now talking to the coding agent. It has sandbox caps (can write
and test code), review caps (can propose changes), and storage (persistent
state).

### Step 2: Agent builds the system

User: "I need a GitHub provider."

The coding agent:
1. Uses sandbox to explore, write, and test the provider code
2. Commits to a branch
3. Calls `review.propose('feat/github-provider', sha)`
4. User reviews in Forgejo, approves
5. Daemon hot-reloads, `github` provider is now available
6. Future exos can destructure `github` from their caps

### Step 3: System runs itself

Custom exos use custom providers. The coding agent can update anything.
Every change goes through Forgejo review. The system grows organically.

---

## Sandbox (bwrap)

Each agent gets its own bwrap sandbox:

```bash
bwrap \
  --ro-bind /nix/store /nix/store \
  --overlay-src /nix/store --tmp-overlay /nix/store \
  --bind .exoagent/agents/EXO-123/root / \
  --bind ~/src/myproject /workspace \
  --tmpfs /tmp \
  --proc /proc \
  --dev /dev \
  --unshare-pid \
  --unshare-net \
  --die-with-parent \
  -- /bin/bash
```

- NixOS system closure for root filesystem (shared, read-only base)
- rw overlay on /nix/store so agent can `nix shell` / `nix build`
- `--dev /dev` is safe — creates fresh minimal devtmpfs (null, zero, random,
  urandom, tty only), does NOT expose host /dev
- Per-agent writable home directory
- Project worktree bind-mounted
- PID namespace (can't see other processes)
- Network namespace (no network)

Depends on storage for persistent agent state / session data.

No images, no volumes, no GC. Kill the process, sandbox is gone. Delete the
agent directory, agent is gone.

### Network

`slirp4netns` provides userspace networking for the sandbox. It creates a TAP
device in the network namespace, tunnels packets over a unix socket / fd. The
host-side slirp process filters:

- Public internet: **allowed** (npm, nix cache, pypi, etc.)
- RFC1918 (10/8, 172.16/12, 192.168/16): **blocked**
- Link-local (169.254/16): **blocked**
- Host: **blocked**

This is the same approach rootless Podman uses. The sandbox can install
anything but can't reach the host or LAN.

### Sandbox ↔ Host RPC

The unix socket carries both network packets (via slirp4netns) and RPC calls
(exo → provider caps on host). Multiplexed with a simple framing:

```
0x01 = network packet
0x02 = RPC call
0x03 = RPC response
```

---

## Pi Integration

Pi runs on the host via SDK. The init exo hooks it directly to stdin/stdout:

```javascript
await pi.interactive({
  capabilities: { sandbox, review, storage },
  stdio: true,
})
```

Pi's builtin tools are replaced with sandbox-backed versions:
- `bash` → `sandbox.exec(command)`
- `read` → `sandbox.read(path)`
- `write` → `sandbox.write(path, content)`
- `edit` → `sandbox.edit(path, old, new)`

The daemon emits raw code calls to the pi session — no UDS needed for
programmatic interaction, it's in-process via the SDK.

For human attachment to non-init pi sessions (future, when multiple agents
run), the simplest approach is tmux: each agent's pi session runs in a tmux
pane. `exoagentd attach <id>` switches to that pane.

---

## Directory Structure

```
src/runtime/
  AGENTS.md
  daemon.ts            The exoagentd process
  provider.ts          Provider interface
  exo.ts               Exo definition + exoeval execution
  dev.ts               Dev environment (wires providers to config)

  providers/
    sandbox.ts         bwrap sandbox — bash/read/write/edit in isolation
    pi.ts              Pi SDK bridge — coding agent sessions
    review.ts          Forgejo-backed code review cap
    storage.ts         Persistent KV + directory management
    secrets.ts         Secrets cap — passed to providers

  exos/
    init.ts            The init exo — spawns the coding agent on stdio

.exoagent/             (in repo root, gitignored except structure)
  secrets.json         Provider secrets
  storage/             KV storage
  agents/              Per-agent state, session files, worktrees
```

---

## Build Plan

### Task 1: Core abstractions
**Files:** `provider.ts`, `exo.ts`, `dev.ts`

Provider interface. Exo definition with cap destructuring. Dev environment
that wires provider classes to config. No exoeval yet — exos run as plain
functions to prove the composition model.

### Task 2: eslint rule + tsconfig for exos
**Files:** eslint config / custom rule, `src/exoeval/allowed.ts`,
`src/runtime/exos/tsconfig.json`

exoeval already has whitelists in `evaluator.ts`:
- **Expressions** (line 402): `ArrayExpression`, `ArrowFunctionExpression`,
  `AwaitExpression`, `BinaryExpression`, `CallExpression`,
  `ConditionalExpression`, `Function`, `Identifier`, `Literal`,
  `LogicalExpression`, `MemberExpression`, `NewExpression`,
  `ObjectExpression`, `TemplateLiteral`, `UnaryExpression`, `ChainExpression`
- **Statements** (line 415+): `BlockStatement`, `EmptyStatement`,
  `VariableDeclaration` (const only), `ExpressionStatement`,
  `ReturnStatement`, `IfStatement`

Export these as shared constants from `src/exoeval/allowed.ts`. The eslint
rule for `src/runtime/exos/` imports the same whitelist and flags anything
not in it. Single source of truth — if exoeval adds a node type, the lint
rule allows it automatically.

Custom `tsconfig.json` for the exos folder: sets `noLib` so none of the
standard lib types (DOM, ES20xx, Node, etc.) are available. Instead, exos
get a single `.d.ts` generated from the builtins that exoeval actually
exposes (Array methods, String methods, JSON, Math, Date, Object.keys/
values/entries, etc.). This way TypeScript itself catches attempts to use
APIs that don't exist in the sandbox — you get red squiggles in the editor,
not just runtime errors.

### Task 3: Exo execution in exoeval
**Files:** `exo.ts`

Wire exo runner to execute through exoeval. Exo source transformed via
esbuild, run through `exoImport`. Destructured caps are the only authority.

### Task 4: Storage provider
**Files:** `providers/storage.ts`

Persistent KV + directory management in `.exoagent/`. Exposes both KV
operations and raw directory paths for mounts, session files, etc.

### Task 5: Secrets provider
**Files:** `providers/secrets.ts`

Reads `.exoagent/secrets.json`. Passed to providers during construction.
Each provider receives only its own secrets by name.

### Task 6: Sandbox provider (bwrap)
**Files:** `providers/sandbox.ts`

bwrap sandbox with bash/read/write/edit caps. NixOS closure with rw overlay
on /nix/store. slirp4netns for filtered networking. Unix socket for RPC.
Depends on storage for persistent sessions.

### Task 7: Pi provider
**Files:** `providers/pi.ts`

Pi SDK integration. Custom tools backed by sandbox. Session management.
Init exo hooks to stdin/stdout via `pi.interactive({ stdio: true })`.

### Task 8: Review provider (Forgejo)
**Files:** `providers/review.ts`

`review.propose(branch, sha)` → creates PR in local Forgejo → blocks
until resolved → returns result with approval status and review comments
(inline code comments, change requests, etc.) so the agent can iterate.

Includes Forgejo setup/management (nix package, local instance).

### Task 9: Daemon
**Files:** `daemon.ts`

The exoagentd process. Loads dev environment, starts builtin providers,
launches init exo, hot-reloads on review approval.

### Task 10: Init exo
**Files:** `exos/init.ts`

Spawns pi on stdin/stdout with sandbox + review + storage caps. The coding
agent takes over.

### Task 11: Let the agent build the rest

The coding agent builds:
- GitHub provider → branch, Forgejo review, approved, loaded
- Linear provider → same flow
- implement-issue exo → same flow

Each goes through the review cap.

### Dependency Order

```
1  Core abstractions          (no deps)
2  eslint rule                (no deps)
3  Exo execution in exoeval   (depends on 1)
4  Storage provider           (depends on 1)
5  Secrets provider           (depends on 1)
6  Sandbox provider           (depends on 1, 4)
7  Pi provider                (depends on 1, 6)
8  Review provider            (depends on 1)
9  Daemon                     (depends on 1, 3, 4, 5, 6, 7, 8)
10 Init exo                   (depends on 9)
11 Agent builds the rest      (depends on 10)
```

Critical path: 1 → 3 → 6 → 7 → 9 → 10 → 11
