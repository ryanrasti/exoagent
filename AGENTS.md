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

## Next Steps (in order)

1. **Exoeval as pi's single custom tool**
   - Instead of bridging N providers → N pi tools, give pi ONE tool: `exoeval`
   - The tool is a BoundEval closure pre-bound to the exo's caps
   - We pass `.d.ts` files for all caps so pi knows the available API
   - Same pattern as pi's existing codemode
   - The agent sees type definitions and calls `exoeval(({ github }) => github.getUser("x"))`

2. **Linear provider**
   - @tool() methods: create/update/query issues, manage projects
   - Config schema for API key
   - Needed for the PM agent

3. **Matrix provider**
   - Use an existing Matrix server (e.g., matrix.org) + private room/space
   - Agent joins as a bot user, sends/receives via Matrix REST API
   - `fetch` provider attenuated to the homeserver domain
   - Connect from phone via Element app — push notifications for free
   - Needed for the PM agent

4. **PM exo (first real agent)**
   - Consumes: pi, linear, matrix, github
   - Pi agent with exoeval tool bound to linear + matrix + github caps
   - Can: triage issues, post updates to Matrix, check GitHub activity
   - Runs as a long-lived exo (polls or responds to events)

5. **VM provider** (for engineer agent)
   - Krun-based sandboxed execution
   - Nix derivation defines rootfs
   - Agent gets a `bash` cap that runs inside the VM

6. **Engineer exo**
   - Consumes: pi, github, vm
   - Pi agent with exoeval tool bound to github + vm caps
   - Can: review PRs, write code, run tests in VM, push branches

## Deferred

- **Git submodule tracking** — runtime repo tracks agent workdirs as submodules
- **IFC (Information Flow Control)** — exoeval already provides the indirection layer
- **Tunnel / remote access** — Tailscale or Cloudflare, after local POC works
