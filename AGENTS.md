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
1. **Type safety** for exos importing provider types (`import type { ... } from 'exoagent/providers/github'`)
2. **LLM context** — the pi provider reads `.d.ts` files and concatenates them into
   the exoeval tool description so the agent knows what caps are available and how to call them

This is one of the main reasons for the separation between providers and the agent runtime.

## Next Steps (in order)

1. **Exoeval as pi's single custom tool**
   - Give pi ONE custom tool: `exoeval`
   - The tool is a BoundEval closure pre-bound to the exo's caps
   - Read `.d.ts` files from `dist/providers/*/index.d.ts` and concatenate into tool description
   - The agent sees type definitions and calls `exoeval(({ github }) => github.getUser("x"))`
   - Wire up tsgo in the build pipeline to emit `.d.ts` files

2. **Linear provider**
   - @tool() methods: create/update/query issues, manage projects
   - Config schema for API key
   - Manifest: depends on config + fetch (attenuated to `api.linear.app`)
   - Unit tests for tool methods (mock fetch responses)

3. **Matrix provider**
   - Use an existing Matrix server (e.g., matrix.org) + private room/space
   - Agent joins as a bot user, sends/receives via Matrix REST API
   - @tool() methods: sendMessage, waitForReply, listRooms
   - Manifest: depends on config + fetch (attenuated to homeserver domain)
   - Config schema for homeserver URL, access token, room ID
   - Unit tests for tool methods (mock fetch responses)

4. **PM exo**
   - Consumes: pi, linear, matrix, github
   - Pi agent with exoeval tool bound to linear + matrix + github caps
   - Can: triage issues, post updates to Matrix, check GitHub activity
   - Runs as a long-lived exo (polls or responds to events)
   - Unit tests for the exo setup logic
   - Lives in `examples/team/src/exos/pm/`

5. **VM provider** (for engineer agent)
   - Krun-based sandboxed execution
   - Nix derivation defines rootfs
   - Agent gets a `bash` cap that runs inside the VM
   - Unit tests with mock VM execution

6. **Engineer exo**
   - Consumes: pi, github, vm
   - Pi agent with exoeval tool bound to github + vm caps
   - Can: review PRs, write code, run tests in VM, push branches
   - Lives in `examples/team/src/exos/engineer/`

## Implementation Notes

### Exoeval tool for pi

The pi provider's `create()` accepts a `capDts` string and a `caps` BoundEval.
It constructs a single pi `ToolDefinition`:

```ts
{
  name: 'exoeval',
  description: `Execute code against the following capabilities:\n\n${capDts}\n\nProvide a JS function: (caps) => { ... }`,
  parameters: Type.Object({ code: Type.String() }),
  execute: async (id, { code }) => {
    const result = await caps(new Function('return ' + code)())
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  }
}
```

### Provider pattern for linear/matrix

Same as github:
```
src/providers/linear/
  index.ts      # @tool() class with API methods
  manifest.ts   # { config: ..., fetch: ... }
  ui.tsx         # config panel (API key, project selection)

src/providers/matrix/
  index.ts      # @tool() class with messaging methods
  manifest.ts   # { config: ..., fetch: ... }
  ui.tsx         # config panel (homeserver, token, room)
```

### Testing approach

- Provider unit tests: mock the BoundEval/exoEval to return canned responses
- Exo tests: mock provider instances, verify the exo calls the right caps
- Integration: the hello exo + daemon smoke test we already have

## Deferred

- **Git submodule tracking** — runtime repo tracks agent workdirs as submodules
- **IFC (Information Flow Control)** — exoeval already provides the indirection layer
- **Tunnel / remote access** — Tailscale or Cloudflare, after local POC works
