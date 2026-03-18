# ExoAgent

## Architecture

**exoagentd** is a runtime daemon that manages:

- **Providers** — capability classes (trusted, unsandboxed). Hold secrets, make API calls. Either builtin or human-reviewed via the review cap.
- **Exos** — sandboxed programs (untrusted). Run in exoeval. Can only call `@tool()` methods on destructured caps.

The **review cap** is the escalation boundary. The agent proposes changes (branch + PR), a human reviews on GitHub, approves or rejects.

### Providers

A provider is a class whose instantiation is a cap. Builtin providers:

- **sandbox** — bwrap-based execution. Provides `exec` inside an isolated namespace with filtered networking (internet yes, LAN/host no).
- **pi** — coding agent via pi SDK. Replaces pi's builtin tools with sandbox-backed versions.
- **review** — GitHub PR-based code review. Pushes branches, opens PRs, fetches reviews.
- **storage** — persistent KV + directory management in `.exoagent/storage/`.
- **secrets** — daemon-only secret store in `.exoagent/secrets/`. Never exposed to exos.

### Exos

Sandboxed programs. Caps are declared by destructuring:

```javascript
export default async ({ sandbox, review, storage, pi }) => {
  await pi.interactive({ stdio: true })
}
```

Only the destructured caps are available. exoeval enforces this at the interpreter level.

---

## Coding Conventions

### Brackets

`if`, `for`, `while` statements must always use curly brackets, even for single-line bodies.

```typescript
// Good
if (condition) {
  doSomething()
}

// Bad
if (condition)
  doSomething()
```

This is enforced by ESLint (`curly: ['error', 'all']`).

### No inline `import()` for types

Use `import type { ... } from '...'` at the top of the file. Inline `import()` types should only appear in `.d.ts` files.

```typescript
// Good
import type { Secrets } from './secrets'

// Bad
secrets?: import('./secrets').Secrets
```

This is enforced by ESLint (`no-restricted-syntax` on `TSImportType`).

### Private instance variables

Do not prefix private instance variables with `_`. Use `private` keyword only.

```typescript
// Good
private session: AgentSession | null = null
private config: ReviewCapConfig

// Bad
private _session: AgentSession | null = null
private _config: ReviewCapConfig
```

### Single source of truth

Do not cache values that are already available from config. Avoid redundant fields.

```typescript
// Good — read directly from config
get token(): string {
  return this.config.secrets.get('review', 'GITHUB_TOKEN')
}

// Bad — redundant cache of a config value
private cachedRepo: string | null = null
getRepo() {
  if (this.cachedRepo) return this.cachedRepo
  if (this.config.repo) { this.cachedRepo = this.config.repo; return this.cachedRepo }
  // ...auto-detect...
}
```

### No fallbacks

Make required config explicit. Don't chain fallbacks (config → env var → CLI tool → error). If something is required, make it a required config field.

```typescript
// Good — token comes from one place
interface ReviewCapConfig {
  secrets: Secrets  // required
  repo: string      // required
}

// Bad — fallback chain
interface ReviewCapConfig {
  secrets?: Secrets  // try this first
  token?: string     // then this
  // then GITHUB_TOKEN env, then `gh auth token`...
}
```

### Constructor / `create` pattern

For classes that need initialization (DB setup, directory creation), use:
1. A `private` constructor that takes a fully-ready dependency (e.g. an open DB handle).
2. A `static create(...)` method that runs initialization once.

```typescript
class StorageCap {
  private constructor(root: string, db: Database.Database, provider: string) { ... }

  static create(root: string, provider = 'default'): StorageCap {
    // Initialize directory, open DB, create tables
    return new StorageCap(resolvedRoot, db, provider)
  }
}
```

### No 1-off wrapper types

Normalize internal data structures to be compatible with API results. Don't create intermediate types just for mapping.

```typescript
// Good — push API-compatible objects directly
for (const c of apiComments) {
  comments.push({ id: c.id, path: c.path ?? '', body: c.body ?? '', diffHunk: c.diff_hunk ?? '' })
}

// Bad — separate wrapper type that just renames fields
interface InternalComment { ... }
function toPublic(c: InternalComment): ReviewComment { ... }
```

### Use typedoc for descriptions

Put descriptions in JSDoc/typedoc comments (which end up in `.d.ts` files), not in `.describe()` calls on zod schemas.

```typescript
// Good — description in JSDoc
/**
 * Push a branch to GitHub and open/update a PR.
 * Remote branch will be auto-prefixed with `exoagent-<agent>/`.
 */
@tool(z.object({ branch: z.string(), title: z.string() }))
async openPR(...) { ... }

// Bad — description in zod .describe()
@tool(z.object({
  branch: z.string().describe('Branch name to push'),
  title: z.string().describe('PR title'),
}))
```

### Regular imports preferred

Use regular top-level imports. Only use inline `await import(...)` when there's a real reason (circular dependency, conditional loading for performance).

```typescript
// Good
import { readFile, rm } from 'node:fs/promises'

// Bad (unless justified)
const { rm } = await import('node:fs/promises')
```

### No separate wrapper files

Don't create a file for a class that just wraps a single function. Inline small cap classes in the file that uses them.

### Security: no tokens in git URLs

Never encode access tokens into git remote URLs. Git push should use the host's SSH key or credential helper. Only GitHub API operations (create PR, fetch reviews) use the token, attached directly to HTTP requests from the host.
