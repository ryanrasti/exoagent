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
  if (this.cachedRepo) { return this.cachedRepo }
  if (this.config.repo) { this.cachedRepo = this.config.repo; return this.cachedRepo }
  // ...auto-detect...
}
```

### No fallbacks

Make required config explicit. Don't chain fallbacks (config → env var → CLI tool → error). If something is required, make it a required config field.

```typescript
// Good — token comes from one place
interface ReviewCapConfig {
  secrets: Secrets // required
  repo: string // required
}

// Bad — fallback chain
interface ReviewCapConfig {
  secrets?: Secrets // try this first
  token?: string // then this
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

Put descriptions in JSDoc/typedoc comments (which end up in `.d.ts` files), not in `.describe()` calls on zod schemas. This is specifically for tools that are passed to agents — the `.d.ts` is what the agent sees.

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

### Instantiate caps once, pass everywhere

Create cap instances at the top level and pass them down. Don't re-instantiate in multiple places.

```typescript
// Good — instantiated once, passed to both
const secrets = Secrets.create(dataDir)
await runSecretsUI(secrets)
const daemon = new Daemon({ secrets })

// Bad — each caller creates its own instance
await runSecretsUI(dataDir) // creates Secrets internally
const daemon = new Daemon({ dataDir }) // creates Secrets internally
```

### No separate wrapper files

Don't create a file for a class that just wraps a single function. Inline small cap classes in the file that uses them.

### No unused config fields

Don't add optional config fields "just in case." If nothing passes a value, remove the field. Add it back when there's an actual caller.

---

## Known Issues / TODO

- **Secret attenuation**: Providers should receive only the specific secrets they need (e.g., `token: string`), not the full `Secrets` object. The caller attenuates by reading the specific secret and passing the value. This prevents providers from accessing secrets belonging to other providers.
- **Review cap `getReviews`**: Returns latest review overall, not latest from the repo owner. Bot reply reviews can shadow the actual human review.
- **`openPR` and `pushBranch` should be separate primitives**: Push handles auth/prefix, openPR is API-only.
- **Sandbox is temporary bwrap, not fully audited**: Current sandbox uses bwrap + pasta + nft (namespace-based). To be replaced with microVM (cloud-hypervisor + virtio-fs). Do not use with untrusted workloads until the microVM migration is complete.
- **Exos not typechecked against restricted sandbox environment**: Exo files import provider types (e.g., `ArgsCap`), which pulls in their full dependency chains (zod, standard lib). `noLib` can't work when tsc resolves into source files that need the standard lib. Fix: build providers first (emit `.d.ts`), then typecheck exos with `noLib` resolving against the `.d.ts` output instead of source. Requires a `paths` or `declarationDir` mapping in the exos tsconfig.
- **Secrets DB not encrypted at rest**: `secrets.db` stores secrets in plaintext SQLite. Should use SQLCipher or similar for encryption at rest. File permissions (0600) are the only protection currently.
- **`generateCapDts` is fragile**: Extracts public method signatures from `.d.ts` output via character-position slicing on the AST. Works but brittle — should use the TypeScript printer API for proper serialization.
- **macOS support**: Sandbox uses bwrap (Linux-only). macOS would need a different sandboxing approach (e.g. `sandbox-exec` / seatbelt profiles). CI is Linux-only for now.
