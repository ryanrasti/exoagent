# exopr — Code Review Provider + Exo

## Overview

Code review tool for agent coding. Human comments on diffs in the browser,
agent reads/responds via `review` cap through exoeval.

Review creation happens in the provider UI: pick an agent, enter a git ref,
create. No CLI or exo needed.

## Agent API (exoeval cap)

The agent gets a `review` cap with @tool-decorated methods:

```ts
// Agent's exoeval tool calls:
({ review }) => review.pendingThreads()
({ review }) => review.reply(threadId, "Fixed by extracting the helper")
({ review }) => review.address(threadId)
({ review }) => review.fileDiff(fileId)
({ review }) => review.status()
```

### ReviewCap methods

```ts
class ReviewCap {
  // Read
  pendingThreads(): Thread[]                 // all open/addressed threads
  fileThreads(fileId: string): Thread[]      // threads on a specific file
  fileDiff(fileId: string): FileDiff         // current diff for a file
  files(): ReviewFile[]                      // all files in the review
  status(): ReviewStatus                     // summary: files, open threads, rounds

  // Write
  reply(threadId: string, body: string): Comment    // add comment to thread
  address(threadId: string): void                   // mark thread as addressed
}
```

### Browser UI uses same RPC

```ts
const threads = await exoRpc<ReviewCaps>(({ review }) => review.pendingThreads())
```

One RPC layer (exoeval) for both human UI and agent.

### Event Subscription

When a comment is created (via UI), the review provider internally
calls `pi.deliver(client, sessionId, 'review', formattedMsg)` for
the agent attached to that review. Agent info stored in reviews table.

## Core Model: Review Rounds

Each file tracked independently through **rounds**.

### Round Lifecycle

```
Round N (reviewing)          Round N+1 (live)
┌─────────────────────┐     ┌─────────────────────┐
│ base_N → snapshot_N  │     │ snapshot_N → worktree│
│ threads: 3 open      │     │ threads: 0           │
└─────────────────────┘     └─────────────────────┘

Human comments on Round N → creates threads.
Agent reads threads, edits files.
Edits appear in Round N+1's diff.

When all Round N threads are resolved/deferred/wontfix:
  Round N collapses.
  Round N+1 becomes the active review round.
  A new Round N+2 appears for subsequent edits.
```

### Pane Display (per file)

Unbounded panels. Each round is a panel, time flows left to right:

```
[Round 1]  [Round 2]  [Round 3]  [Round 4]  [Live]
 frozen     frozen     frozen     frozen     worktree
 2 threads  1 thread   0 threads  3 threads
 resolved   deferred→4           open
```

At any time there is exactly **one mutable panel** (the rightmost one).
Agent edits accumulate on it. When a human adds the first thread to it:
1. Snapshot the current file content → panel freezes
2. A new mutable panel appears to the right

```
[R1 frozen]  [R2 frozen]  [R3 mutable]
                           agent edits accumulate here
                           ↓ human comments
[R1 frozen]  [R2 frozen]  [R3 frozen]  [R4 mutable]
```

Frozen panels are immutable — threads are always correct within their
panel because the snapshot never changes.

User manages complexity by:
- **Resolving** threads → round is "done", can be collapsed/hidden
- **Deferring** threads → thread moves to a later round
- **Scrolling** horizontally through round history

Completed rounds (all threads resolved/wontfix/deferred) are collapsed
by default but expandable.

### Diff Coloring

Diffs are always computed against the left neighbor panel:

```
[Round 1]       [Round 2]              [Round 3]           [Live]
 no diff    diff(R1 → R2)         diff(R2 → R3)      diff(R3 → worktree)
```

First panel (base ref) has no diff coloring. Every subsequent panel
shows adds/removes relative to its left neighbor.

### Threads and Comments

A **thread** is an anchor on a diff (file + line range). It has lifecycle.
A **comment** is a message within a thread. No status — just content.

```
Thread (file:line 42-45, status: open)
  ├── Comment (human): "This should use a for...of loop"
  ├── Comment (agent): "Fixed, switched from forEach"
  └── Comment (human): "Thanks"
→ thread resolved (resolved_at set)
```

Thread states:
```
open → addressed    (agent claims fixed)
     → resolved     (human confirms — sets resolved_at)
     → wontfix      (human dismisses)

addressed → resolved (human confirms)
          → open     (human reopens)
```

**Defer** is not a state — it's an action that moves the thread to the current
Live round (keeping `open` status). The thread's `original_round_id` tracks
where it was first created, `round_id` is its current round.

A round can shift out of the viewport when all its threads are resolved,
wontfix, or moved (deferred) to a later round.

## File Layout

```
examples/team/src/
  providers/review/
    index.ts            — ReviewProvider: state, agent plumbing, comment routing
    manifest.ts         — deps: pi; ring0: better-sqlite3, child_process
    ui.tsx              — entry point, mounts ReviewApp
    ui/
      ReviewApp.tsx     — main 3-pane layout
      FileList.tsx      — sidebar file list
      DiffPane.tsx      — diff viewer with thread anchors
      ThreadView.tsx    — thread + comment list
      RoundIndicator.tsx
      hooks/
        useReview.ts    — polling + state
        useThreads.ts   — thread CRUD via exoRpc

```

### Review provider

Owns all review state, UI, and agent plumbing. Depends on `pi` for
listing agents and delivering comments to them.

```ts
// examples/team/src/providers/review/index.ts
class ReviewProvider {
  // Review lifecycle
  @tool(...) create(opts: { ref: string, repoRoot: string, agent: { client: string, sessionId: string } }): Review
  @tool(...) findByRef(ref: string): Review | null
  @tool(...) list(): Review[]

  // Agent picker — uses pi cap to list available agents
  @tool() listAgents(): { client: string, sessionId: string, alive: boolean }[]

  // Review content (agent-facing + UI-facing via exoRpc)
  @tool() pendingThreads(reviewId: string): Thread[]
  @tool() fileThreads(reviewId: string, fileId: string): Thread[]
  @tool() fileDiff(reviewId: string, fileId: string): FileDiff
  @tool() files(reviewId: string): ReviewFile[]
  @tool() status(reviewId: string): ReviewStatus

  // Thread interaction
  @tool() reply(threadId: string, body: string, author: string): Comment
  @tool() address(threadId: string): void
}
```

When a comment is created, the provider looks up the attached agent
(stored in reviews table) and calls `pi.deliver(client, sessionId, ...)`.

### UI: Review Creation

The provider UI handles review creation — no exo or CLI needed:

1. Open `review.localhost:3000/` in browser
2. **Picker**: select agent (dropdown from `listAgents()`), enter git ref
3. Click "Create Review"
4. UI transitions to 3-pane diff view

```tsx
// In the UI
const agents = await exoRpc(({ review }) => review.listAgents())
const r = await exoRpc(({ review }) => review.create({
  ref: 'HEAD',
  repoRoot: '/path/to/repo',
  agent: { client: 'pm', sessionId: 'main' }
}))
// navigate to review view
```

## SQLite Schema

```sql
CREATE TABLE reviews (
  id          TEXT PRIMARY KEY,
  base_ref    TEXT NOT NULL,
  repo_root   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE review_files (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL REFERENCES reviews(id),
  path        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(review_id, path)
);

CREATE TABLE rounds (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL REFERENCES review_files(id),
  round_num   INTEGER NOT NULL,
  base_content TEXT,          -- content inherited from previous round's snap (or ref for round 1)
  snap_content TEXT,          -- set on freeze (first thread added) — NULL while mutable
  created_at  INTEGER NOT NULL,
  UNIQUE(file_id, round_num)
);

CREATE TABLE threads (
  id                TEXT PRIMARY KEY,
  round_id          TEXT NOT NULL REFERENCES rounds(id),
  original_round_id TEXT NOT NULL REFERENCES rounds(id),
  line_start        INTEGER NOT NULL,
  line_end          INTEGER,
  snippet           TEXT,           -- code at line_start:line_end when thread created (belt-and-suspenders)
  status            TEXT NOT NULL DEFAULT 'open',  -- open | addressed | resolved | wontfix
  resolved_at       INTEGER,
  created_at        INTEGER NOT NULL
);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES threads(id),
  body        TEXT NOT NULL,
  author      TEXT NOT NULL,     -- 'human' | 'agent'
  created_at  INTEGER NOT NULL
);
```

## Testing Strategy

Every part of the spec has tests. Tests live in `examples/team/`.
UI is built to be manually walkable first, then codified with Playwright.

### Test infrastructure

- `vitest` for unit/integration (layers 1–5)
- `playwright` for e2e (layer 6)
- Shared fixture: `createTestRepo()` makes a temp git repo with known state

```ts
// examples/team/src/__tests__/fixtures.ts
const createTestRepo = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'exopr-test-'))
  await exec('git init && git config user.email "t@t" && git config user.name "T"', { cwd: dir })
  await writeFile(join(dir, 'hello.ts'), 'const x = 1\n')
  await writeFile(join(dir, 'utils.ts'), 'export const add = (a: number, b: number) => a + b\n')
  await exec('git add . && git commit -m "init"', { cwd: dir })
  // Uncommitted changes
  await writeFile(join(dir, 'hello.ts'), 'const x = 2\nconst y = 3\n')
  await writeFile(join(dir, 'new-file.ts'), 'export const NEW = true\n')
  return { dir, cleanup: () => rm(dir, { recursive: true }) }
}
```

### Layer 1: DB (vitest, `:memory:` SQLite)

Fast, pure, no I/O beyond SQLite. Every state transition tested.

```
src/__tests__/db/reviews.test.ts
  - create review → get by id → find by ref
  - list reviews returns all
  - create with agent attachment → persisted

src/__tests__/db/files.test.ts
  - add files to review → list returns them
  - file status transitions: pending → reviewing → done

src/__tests__/db/rounds.test.ts
  - create round 1 for file → round_num = 1, snap_content = NULL (mutable)
  - freeze round (first thread added) → snap_content set to current file content
  - freeze creates new mutable round (round_num + 1)
  - new round's base_content = previous round's snap_content
  - multiple freezes: round_num increments correctly
  - round 1 base_content = file content at base ref

src/__tests__/db/threads.test.ts
  - create thread on round → status = open
  - address thread → status = addressed
  - resolve thread → status = resolved, resolved_at set
  - reopen addressed thread → status = open
  - wontfix thread
  - defer thread → round_id changes, original_round_id preserved
  - all threads resolved → round is shiftable
  - mix of resolved + wontfix → still shiftable
  - one open thread → round not shiftable

src/__tests__/db/comments.test.ts
  - create comment on thread → author + body correct
  - multiple comments → ordered by created_at
  - comment on thread in different round
```

### Layer 2: Git (vitest, temp repos)

Real git repos in tmpdir.

```
src/__tests__/git/diff.test.ts
  - diff tracked file against HEAD → shows changes
  - diff new untracked file → shows entire file as added
  - diff deleted file → shows entire file as removed
  - diff binary file → handled gracefully
  - file content at ref → returns old content

src/__tests__/git/status.test.ts
  - detect modified files
  - detect untracked files (not ignored)
  - detect deleted files
  - .gitignore'd file → not included
  - nested .gitignore → respected

src/__tests__/git/visibility.test.ts
  - tracked file → visible
  - untracked, not ignored → visible
  - untracked, in .gitignore → not visible
  - new file added after review created → picked up by chokidar, checked via git
  - file deleted after review created → detected
```

### Layer 3: ReviewCap (vitest, real SQLite + real git)

Test @tool methods end-to-end through the cap.

```
src/__tests__/cap/review-cap.test.ts
  - create(ref, repoRoot, agent) → files() returns git-visible files
  - pendingThreads() on fresh review → empty
  - create thread + reply() → pendingThreads() returns it with comments
  - address() → thread status = addressed
  - resolve all threads → round shifts, new round created
  - fileDiff() returns diff(left pane, this pane)
  - status() returns correct counts
  - listAgents() → delegates to pi mock, returns agent list
  - comment triggers delivery to attached agent (pi.deliver mock called)
```

### Layer 4: exoRpc (vitest + Hono test client)

Test the RPC round-trip — same path the browser UI uses.

```
src/__tests__/api/rpc.test.ts
  - exoRpc(({ review }) => review.create(...)) → returns review
  - exoRpc(({ review }) => review.pendingThreads(id)) → returns threads
  - exoRpc(({ review }) => review.reply(tid, body, author)) → comment created
  - error handling: invalid reviewId → error response
  - concurrent calls don't corrupt state
```

### Layer 5: UI components (vitest + testing-library)

Render with mock data, verify DOM output.

```
src/__tests__/ui/FileList.test.tsx
  - renders file names
  - shows status badges (pending, reviewing, done)
  - click file → onSelect callback fires

src/__tests__/ui/DiffPane.test.tsx
  - renders diff with add/remove coloring
  - click line → shows comment input
  - thread markers on commented lines

src/__tests__/ui/ThreadView.test.tsx
  - renders thread with all comments
  - shows status badge (open, addressed, resolved)
  - resolve button → calls resolve handler
  - defer button → calls defer handler

src/__tests__/ui/Picker.test.tsx
  - renders agent dropdown with options
  - renders ref input
  - submit → calls onCreate with agent + ref

src/__tests__/ui/ReviewView.test.tsx
  - 3-pane layout renders
  - Old pane has no diff coloring
  - Review pane colored as diff(Old, Review)
  - Live pane colored as diff(Review, Live)
```

### Layer 6: E2E (Playwright)

Full browser, real daemon, temp git repo. Each test:
1. Creates a temp repo
2. Starts the daemon (or connects to running one)
3. Opens the review provider UI
4. Performs the interaction
5. Asserts visible state

**Build each feature to be manually walkable first, then codify.**

```
src/__tests__/e2e/picker.test.ts
  - open UI → see picker
  - agent dropdown populated
  - select agent + enter ref + create → navigates to review
  - existing review at ref → shows option to reopen

src/__tests__/e2e/review-flow.test.ts
  - create review → file list shows changed files
  - click file → 3-pane view, Old + Review panes visible
  - Old pane shows file at ref, Review shows current diff

src/__tests__/e2e/comment-flow.test.ts
  - click line in Review pane → comment input appears
  - type comment + submit → thread appears on that line
  - thread shows in sidebar thread list
  - simulate agent reply (direct API call) → reply appears in thread
  - simulate agent address → thread status updates to "addressed"
  - click resolve → thread status = resolved, resolved_at shown

src/__tests__/e2e/panels.test.ts
  - create review, add 2 threads on round 1
  - resolve both threads → round 1 collapses
  - expand collapsed round → threads still visible
  - agent edits create new panel → shows diff against previous
  - diff coloring always relative to left neighbor

src/__tests__/e2e/defer.test.ts
  - create thread on Review pane
  - click defer → thread moves to Live round
  - thread still open, original_round_id preserved
  - if all remaining threads resolved → viewport shifts

src/__tests__/e2e/live-updates.test.ts
  - create review
  - modify file on disk (outside browser)
  - Live pane updates to show new diff
  - diff is relative to Review pane snapshot
```

## Coding Conventions

- Prefer `for (const x of y) {}` over `.forEach()`
- Prefer `{ [key: string]: T }` over `Record<string, T>`
- Prefer `type` over `interface`
- Prefer `const fn = () => {}` over `function fn() {}`
- Use regular method syntax in classes
- Tabs for indentation

## Build Notes

### Playwright + Nix

Playwright browsers come from nixpkgs (`playwright-driver` 1.58.2).
The npm `@playwright/test` version **must match exactly**: `1.58.2`.
Set `PLAYWRIGHT_BROWSERS_PATH` to the nix store path in the devShell.
The flake.nix needs `playwright-driver` added to packages.

### Implementation Order

**Keep going until the entire app + all tests are complete.**

Building the full app + tests in one pass:

1. **Scaffold**: package.json, tsconfig, vitest config, playwright config,
   flake.nix update, provider dir structure
2. **DB layer + layer 1 tests**: schema.ts, all CRUD, every state transition
3. **Git ops + layer 2 tests**: diff, status, visibility, temp repo fixtures
4. **ReviewCap + layer 3 tests**: @tool methods, real SQLite + git, mocked pi
5. **RPC + layer 4 tests**: Hono test client, exoRpc round-trip
6. **UI components + layer 5 tests**: Picker, FileList, DiffPane, ThreadView,
   ReviewView — each with testing-library tests
7. **Wire it all up**: provider index.ts, manifest.ts, register in provider-mount
8. **E2E + layer 6 tests**: Playwright — picker, review flow, comment flow,
   round shift, defer, live updates
9. **Polish**: error handling, edge cases (binary files, empty files, large diffs)

Each step: implement + tests before moving to next. `npm run check` after each.

## Workflow

Run `npm run check` from `examples/team/` before committing.

## Open Questions

1. **Provider UI registration** — `provider-mount.tsx` panel map is hardcoded.
   Workspace providers need dynamic registration. For now: add `review` to the
   map manually.

2. **File change detection** — chokidar watches repo root. On change,
   filter through git (`git check-ignore -q`) to skip .gitignore'd files.
   Provider recomputes Live pane diff and pushes to browser.
   chokidar v4 (ESM-only, lightweight). Git-visible = tracked OR
   untracked-but-not-ignored. Edge cases: file added (empty Old pane),
   file deleted (empty Live pane).

3. ~~`exoagent run`~~ — not needed, review creation happens in provider UI.

4. **Review scoping** — auto-detect git root from EXOAGENT_DIR via
   `git rev-parse --show-toplevel`. EXOAGENT_DIR may be a subdirectory
   (e.g., `examples/team/` inside the exoagent repo). Override in picker.

## Next Steps

1. **Test setup in examples/team** — vitest + playwright configs
2. **Review provider: DB + tests** — schema, CRUD, thread lifecycle, round shift
3. **Review provider: git ops + tests** — diff extraction, temp repo fixtures
4. **Review provider: agent picker** — listAgents() via pi dep, attach on create
5. **Review provider: UI scaffold** — register in provider-mount, picker + 3-pane
6. **Thread flow + e2e** — add/reply/address/resolve cycle in browser
7. **Panel collapse/expand + e2e** — completed rounds collapse, expandable
8. **Comment routing** — new comment → pi.deliver for attached agent
