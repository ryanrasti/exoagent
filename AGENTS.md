## Coding Conventions

- Prefer `for (const x of y) {}` over `.forEach()`. Use `for...of` for all iteration.
- Prefer `{ [key: string]: T }` over `Record<string, T>`.
- Prefer `type` over `interface` for all type declarations.
- Prefer `const fn = () => {}` over `function fn() {}` for top-level and local functions.
- Use regular method syntax in classes (`foo() {}` not `foo = () => {}`).

## 3/30 Workerd + capnweb -> SES + exoeval
Rationale:
1. workerd/isolates/capnweb is RPC-first, but providers are just libraries
2. what is really needed is isolating providers from external side-effects/each others internal data
    * SES is sufficient without an entire layer wrapping it -- much simpler
3. exoeval comes back from main
    * simpler wire format (just JS)
    * IFC ready
    * much smaller, auditable surface area for malicious code (e.g., from the vms) + defense in depth
      running in own SES realm

What to do:
1. Rip out workerd/wrangler/CF stack
2. Bring in SES
3. exoagentd now:
  - sets up SES
  - for each provider:
    -> loads manifest.js in exoeval (manifests are always .js, no TS build step)
    -> gets list of providers
    -> dag sorts them & instantiates (deterministic, break ties alphabetically)
      -> runs the manifest to pass the attenuated caps
    -> note that providers will each take a single **exoeval** closure with the manifest caps pre-bound.
       aside from providers that take native functions (e.g., fs/subprocess), that's the only sharing
       we'll do via SES
4. single package (not monorepo), subpath exports per provider:
   - `exoagent/providers/github` → `dist/providers/github/index.js` + `.d.ts`
   - consumers: `import type { GitHubProvider } from 'exoagent/providers/github'`
5. three build steps:
   | step       | tool    | input                        | output                              |
   |------------|---------|------------------------------|-------------------------------------|
   | BE bundles | esbuild | `src/providers/*/index.ts`   | `dist/providers/*/index.js` (1 file each) |
   | BE types   | tsgo    | `src/providers/*/index.ts`   | `dist/providers/*/index.d.ts`       |
   | FE bundles | Vite    | `src/ui/*/index.html`        | `dist/ui/*/` (1 bundle each)        |
6. SES loading: daemon reads each provider's bundled .js as a string,
   evaluates in a Compartment. Same in dev and prod (esbuild is ~10ms).
   Dev uses `tsx --watch` to restart on changes.
7. FE dev: Vite dev server with HMR, proxies /api/* to Hono backend.
   FE prod: Vite build → per-provider bundles, served by Hono.

Decisions:
- @tool() decorator marks methods as callable by the exoeval interpreter.
  All cap invocations (exo -> provider AND provider -> provider) go through exoeval.
  Single path, single calling convention.
- Deferred: SES layer where @tool() also produces hardened object trees via harden()
  for direct inter-provider calls. For now, exoeval is the only invocation path.
- storage: single SQLite database (better-sqlite3) partitioned by provider name.
  Secrets in a separate DB with 0600 permissions. Both from main branch.

Provider UI:
- React SPAs, one per provider
- each provider is an npm package that exports:
  - backend: @tool() class
  - frontend: React components for its UI panel
- exoeval is the RPC mechanism: POST /api/<provider>
  - request body: exoeval JS expression string
  - response body: JSON (which is valid JS)
  - the provider's @tool() methods are bound as caps in the eval context
  - errors: 500 with error message
  - example:
    request:  github.getUser("octocat")
    response: {"login":"octocat","id":583231}
  - the SPA imports provider types from the same npm package, so types
    are already available at build time. No separate API docs needed.
  - future: response as exoeval JS (AST -> JS serializer) for non-JSON types
    (dates, undefined, cap references). JSON.stringify is the MVP.
- backend: Hono (web-standard Request/Response, minimal boilerplate)
  single Node HTTP server in exoagentd
- UI isolation via subdomain-per-provider:
  - dashboard at http://localhost:3000/
  - each provider UI at http://<provider>.localhost:3000/
  - browser same-origin policy enforces isolation between providers
    (separate JS contexts, storage, cookies — no shared globals)
  - *.localhost resolves to loopback per RFC 6761 (Chrome, Firefox)
  - Hono routes by Host header, one port, one server
  - per-provider session tokens: dashboard mints a scoped token when
    loading a provider UI. RPC endpoint rejects requests without a
    valid token for that provider. Prevents cross-provider API calls.
  

## Implementation Plan (3/30)
1. Bring back exoeval + storage/secrets from main (single commit)
2. Rip out workerd/wrangler/CF stack (loader, wrangler.jsonc, CF types, @exoagent/* packages, vitest pool-workers)
3. Set up single package structure (drop monorepo, subpath exports, esbuild + tsgo + Vite build)
4. Hono server (subdomain routing, exoeval RPC endpoint, static file serving)
5. GitHub provider (@tool() class + React UI panel, end-to-end hello world)

## 3/30 Overhaul (historical, superseded by SES+exoeval above)

exoagentd is the kernel, VMs are processes, caps are syscalls.

1. Gutting -- almost everything goes, we're building on a new model. Keep only:
  a. Minimal flake.nix with nodejs
  b. LICENSE.md
  c. eslint.config.js
  d. tsconfig.json
  e. gitignore

2. New architecture
  a. control plane:
    - workerd (via npm package, not nix)
    - wrangler for dev/build/test, workerd serve for production
    - container management (podman with krun isolation)
  a2. security layering:
    - host (never touched)
      └── provider krun VM (hard boundary)
            └── workerd (isolate-per-provider, soft boundary)
                  ├── github isolate
                  ├── slack isolate
                  └── linear isolate
      └── agent krun VM (hard boundary, one per agent)
            └── untrusted code runs here
                  └── calls caps via UDS → workerd
    - workerd isolates are defense-in-depth for YOUR trusted provider code
    - workerd's security disclaimer is irrelevant: it runs inside a krun VM
    - untrusted agent code never runs in workerd — own krun VM
    - agent VM talks to provider caps via unix domain socket + capnweb
  b. global storage
    - workerd durable objects with localDisk storage (sqlite-backed)
  c. capability providers (providers/plugins)
    - these are npm packages in their own right
    - provide .d.ts for types, .js for runtime
    - providers are dynamic workers loaded via WorkerLoader, same as exos
    - providers extend RpcTarget (capnweb), exos get stubs to call them
    - only difference from exos is trust level: providers get more bindings
      (secrets, network access), exos get fewer
    - reloading is uniform: change code in runtime repo, control plane
      re-loads the worker. providers and exos reload the same way.
    - core capabilities
      - createAgent / getAgent / ensureAgent
        - ensureRunning()
        - createAgent specifies definition for an agent, including:
          - name
          - initial capabilities
          - prompt
      - vm
        - create a new vm image rootfs based on a nix derivation
        - will have rw overlay
        - vm is meant to be used with agent -- so agent can do arbitrary stuff
        - krun as the execution primitive -- vm is not persistent, runs command
          then exits. no image persistence, just rootfs/workdir mounts
      - no separate config/secrets provider -- each provider is a DO
        with its own SQLite and manages its own config/secrets
  d. "exos"/binaries/agent definitions
    - this is static code that run scoped tasks
    - tasks can be one shots or e.g., crons (probably simplest to make cron a provider
      itself that registers a callback)
    - one of the "scoped tasks" can be to spawn an agent
    - agent can have access to a "bash" tool which lets
      it run its own rootfs (defined by nix derivation) krun container
      - container itself has a channel to also run the caps -- via
        an npm package/binary -- e.g., exoeval '(caps) => <code>'
    - exos are dynamic workers loaded via WorkerLoader.get(name, getCode)
    - cap attenuation via env: each exo only gets the bindings it needs
    - globalOutbound: null to block network, or pass a filtering fetcher
    - workerd's V8 isolate IS the sandbox -- replaces exoeval/bwrap
  e. capability rpc transport: capnweb (https://github.com/cloudflare/capnweb)
    - js-native, no schemas, typescript-friendly
    - RpcTarget for pass-by-reference objects (providers)
    - promise pipelining for batching calls
    - works over websocket, http batch, messageport
    - built-in workers interop (newWorkersRpcResponse)
  f. provider structure
    - each provider exports a single class as its root cap
    - the class has methods to create scoped/attenuated views
    - e.g., Config exports ConfigProvider with `.for(name)` method
    - control plane instantiates the root, calls scoping methods itself
    - providers/exos never see the root cap — only scoped views
  g. manifest-based cap attenuation
    - every cap is an RpcTarget instance
    - every provider/exo declares a manifest: what caps it needs and how to attenuate them
    - manifest.ts:
      ```ts
      export default: Manifest = {
        config: (config) => config,                        // already scoped by control plane
        fetch: (fetch) => fetch.scoped('api.github.com'),  // manifest attenuates
      }
      ```
    - each entry is `(cap: RpcTarget) => unknown` — uniform shape
    - two kinds of attenuation:
      - control plane scoping: identity-based, enforced before manifest runs
        e.g., config.for('github') — provider can't choose its own scope
      - manifest scoping: declared by the provider/exo
        e.g., fetch.scoped('api.github.com') — provider says what it needs
    - at boot/reload, control plane:
      1. reads the manifest
      2. for each entry, gets the root cap, applies control plane scoping
         (e.g., config.for(providerName))
      3. passes pre-scoped caps to the manifest lambda for further attenuation
      4. passes results as env.providers to WorkerLoader.load()
    - the manifest IS the security boundary — readable, auditable, enforced
    - network access is also a cap: fetch provider wraps global fetch
      - no fetch cap in manifest = globalOutbound: null = no network
      - fetch.scoped('api.github.com') = only that domain
    - provider/exo receives env.providers = { config: ScopedConfig, fetch: ScopedFetch, ... }
      all RpcTarget stubs, nothing else
    - two-phase loading via shim:
      - manifest is code, so it runs in the same sandboxed worker as the actual code
      - but root caps must never be reachable by the actual code
      - solution: single dynamic worker, two phases
        1. control plane loads the worker with three modules:
           - shim.js (mainModule) — generic, same for all providers/exos
           - manifest.js — the manifest function
           - worker.js — the actual provider/exo code
        2. shim.js statically imports manifest.js, runs it with root caps
        3. shim.js then does `await import('./worker.js')` — dynamic import
           so worker.js is not parsed/executed until after attenuation
        4. shim passes only attenuated caps to worker.js's default export
        5. root caps were function-scoped in the shim, now out of scope and GC'd
      - worker.js never sees root caps — JS scope isolation enforces this
      - dynamic import is key: static import would hoist and run worker.js
        before manifest completes
      - worker.js resolves against the modules map in WorkerLoader.load(),
        no filesystem or network needed
      ```ts
      // shim.js
      import manifest from './manifest.js'
      export default {
        async start(rootCaps) {
          const caps = manifest(rootCaps)
          const { default: init } = await import('./worker.js')
          init(caps)
        }
      }
      ```

  h. web UI
    - every provider/exo can optionally export a fetch() handler to serve a UI
    - control plane routes by name: /<provider-name>/... → provider's fetch()
    - e.g., /config/... → config provider's UI, /github/... → github provider's UI
    - each provider builds its own static assets (react+vite) or inline HTML
    - localhost only: workerd socket binds to 127.0.0.1
  i. dashboard
    - / → exoagent dashboard (React app served by control plane)
    - single pane of glass: lists all providers/exos with status
    - links to each provider's UI panel (/<name>/)
    - surfaces issues: missing config, crashed providers, pending actions
    - providers can expose an optional status() RPC method for the dashboard to poll
    - search across all providers/exos
  j. provider self-management
    - every provider is a DurableObject by default — gets its own SQLite
    - each provider owns its own config/state in its own DO storage
    - provider's UI panel (/<name>/) is its own config/management interface
    - config provider is just for global bootstrap secrets (API keys needed to start)
    - once running, each provider manages its own settings, state, and UI autonomously

3. Runtime
  a. `exoagentd` -- bash script that generates capnp config and exec's workerd serve
  b. control plane worker has WorkerLoader binding, loads providers and exos as
     dynamic workers
  c. `init` -- looks at all exos, instantiates them (runs code, saves return value --
     which can be a raw result or an `info` cap e.g., to get info about a cron run)
  d. can query exoagentd to figure out:
    - currently running exos
    - paused exos 
    - exited exos
  e. can kill exoagentd

4. Two-repo structure
  a. exoagent (this repo): the kernel
    - control plane worker
    - provider framework
    - exo loader
    - exoagentd script
    - CLI
  b. runtime (user's repo): the state of the world
    - separate git repo, exoagent points to it
    - exo definitions (JS/TS files)
    - provider config (which providers, what secrets they need)
    - agent workdirs as git submodules
      - agent owns its submodule, free reign to commit/branch/push
      - exoagentd commits submodule pointer updates as agents progress
      - runtime repo is the audit trail: git log shows every state change
      - can roll back agent work by resetting submodule pointer
    - git status on runtime repo = what every agent has been doing

5. First use cases: 
  a. Project Manager agent
    - Caps
      - Github: see team/user's activity
      - Slack: talk with team/user
      - Linear: manage project tickets
  b. Engineer agent
    - Caps
      - Github: create PR/poll issues mentioned in/make comment in **that** PR/respond to PR comments
      - VM: work on code locally, test it
    - Eventual goal: build out new projects/manage old projects with agents
