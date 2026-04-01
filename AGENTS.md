## Coding Conventions

- Prefer `for (const x of y) {}` over `.forEach()`. Use `for...of` for all iteration.
- Prefer `{ [key: string]: T }` over `Record<string, T>`.
- Prefer `type` over `interface` for all type declarations.
- Prefer `const fn = () => {}` over `function fn() {}` for top-level and local functions.
- Use regular method syntax in classes (`foo() {}` not `foo = () => {}`).

## Open Design Questions

1. **Module namespacing vs UI routing.** Modules are namespaced by origin:
   - `@exoagent/providers/pi` (built-in)
   - `./exos/hello` (workspace)
   - `<npm-pkg>/providers/foo` (npm, future)
   
   Subdomains can't represent these names (no `@` or `/` in DNS). Currently we use
   short names (`pi.localhost:3000`) with collision = error, but this won't scale to
   npm packages.
   
   The right solution is probably **path-based routing with iframes**: each module UI
   loads at `localhost:3000/ui/<full-name>/` inside an iframe. The iframe's only way
   out is `postMessage` to the parent dashboard — enforcing isolation without relying
   on subdomains. The server must set `X-Frame-Options` / CSP to prevent cross-origin
   framing (should be default, needs a test).

## Future Features / Use Cases

1. Implement Submodule Git Tracking
   - The runtime repo is the state of the world.
   - Agent workdirs as git submodules.
   - `exoagentd` commits submodule pointer updates as agents progress.
   - Git status on runtime repo = what every agent has been doing.

2. Capability Providers to implement:
   - `bash`: allow execution of host-level or local tools.
   - `vm`: create a new vm image rootfs based on a nix derivation via Krun.
   - `slack`: talk with team/user.
   - `linear`: manage project tickets.

3. "Exos" / Agent definitions:
   - Provide a way to run static code for scoped tasks (e.g. crons).
   - Engineer Agent: GitHub cap (create/poll/respond to PRs) + VM cap (local testing).
   - Project Manager Agent: GitHub (team activity), Slack (chat), Linear (tickets).
