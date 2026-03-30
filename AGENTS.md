## Coding Conventions

- Prefer `for (const x of y) {}` over `.forEach()`. Use `for...of` for all iteration.

## 3/30 Overhaul

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
