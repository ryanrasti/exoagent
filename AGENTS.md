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

2. **Bridging @tool() methods → pi ToolDefinitions.** Exos need to pass exoagent
   provider caps to pi agents as custom tools. Need an adapter that takes a provider's
   `@tool()` methods and produces pi `ToolDefinition`s with proper TypeBox schemas.
   This is the key missing piece for a useful agent.

3. **Agent cwd.** Pi agents currently run in `.exoagent/providers/pi/<client>/<id>/`
   which is empty. Exos should be able to set cwd to an actual repo. Need to decide:
   does the exo pass an absolute path, or does pi clone/mount something?

## Next Steps

1. **@tool() → pi ToolDefinition bridge**
   - Adapter that introspects a provider's `@tool()` methods (zod schemas)
   - Produces pi `ToolDefinition`s (TypeBox schemas + execute function)
   - Exo passes these as `customTools` to `pi.create()`
   - Hello exo becomes: pi agent with GitHub tools in a real repo

2. **Real engineer exo**
   - Points pi at a repo (cwd)
   - Gives it GitHub tools (read PRs, post comments, push branches)
   - Gives it bash/read/edit/write for the repo
   - Can be prompted: "review the latest PR and post comments"

3. **Matrix provider** (replaces Slack)
   - Self-hosted Conduit server (lightweight Rust Matrix homeserver)
   - Connect from phone via Element app
   - Agent sends/receives messages via Matrix REST API
   - `fetch` provider attenuated to Matrix homeserver domain

4. **Tunnel / remote access**
   - Tailscale (zero config, private) or Cloudflare Tunnels (public, needs auth)
   - Expose dashboard + provider UIs from anywhere
   - Needs wildcard subdomain support or the iframe routing from #1

5. **VM provider**
   - Krun-based sandboxed execution
   - Nix derivation defines rootfs
   - Agent gets a `bash` cap that runs inside the VM
   - Defense in depth: SES for JS isolation, VM for OS isolation

6. **Git submodule tracking**
   - Runtime repo (e.g., `examples/team`) tracks agent workdirs as submodules
   - `exoagentd` commits submodule pointer updates as agents progress
   - Git log = audit trail of all agent activity

7. **IFC (Information Flow Control)**
   - Deferred. exoeval already provides the indirection layer.
   - When ready: tag data with labels, exoeval enforces flow constraints
