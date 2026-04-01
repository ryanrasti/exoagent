# Exoagent Architecture

## Principles & Goals
`exoagentd` acts as a kernel. Capability providers are plugins that offer safe, attenuated access to external resources or native functions. "Exos" (agents or tasks) are dynamic pieces of code that consume these capabilities to do useful work.

We rely on **SES (Secure ECMAScript)** to enforce object-capability (ocap) security boundaries. Each provider (and eventually each exo) runs in its own SES Compartment. No shared globals, no direct filesystem access, no un-attenuated network access.

## Architecture Overview

### 1. The Daemon (`exoagentd`)
The daemon initializes SES via `lockdown()`, sets up the environment, and manages the lifecycle of all providers. It operates as the "Ring 0" root of trust.

- Sets up the Hono HTTP server for the UI and RPC.
- Initializes the DAG-based `ProviderLoader`.
- Evaluates the core capabilities (like `sqlite` and `fetch`) using native node bindings.

### 2. Capability Providers
Providers are isolated libraries loaded into their own SES `Compartment`.

- **Subpath Exports:** Each provider is an isolated package under `src/providers/<name>`.
- **Pre-Bundling:** Providers are AOT-compiled by esbuild into a single JS file to remove transpilation/decorator overhead from the runtime.
- **Manifests:** Every provider has a `manifest.ts` declaring its dependencies.
  - E.g., GitHub declares it needs `config` (to store tokens) and `fetch` (to make API calls).
  - The loader reads these manifests, topologically sorts the providers, and injects the attenuated capabilities during instantiation.

### 3. Exoeval & Object Capabilities
All cross-boundary capability invocations route through `exoeval`.

We use `exoeval` inside our SES compartments rather than just using SES object capability sharing for two main reasons:
1. **Indirection / Hot-Reloading:** It adds a layer of indirection, allowing us to swap out provider implementations behind the scenes without breaking references in running compartments.
2. **Unified Interface:** Eventually, agent "exos" will also use `exoeval`. This keeps a single, uniform interface for interacting with capabilities, whether it is Provider-to-Provider or Agent-to-Provider.

- **`@tool()` Decorator:** Marks a class method as safely callable by another compartment.
- **`BoundEval`:** Providers receive a `BoundEval` function (often called `this.exoEval`) that allows them to execute closures using the capabilities they were granted.
- **Isolation:** A provider does not receive raw access to another provider's instance. It can only execute serialized closures against the attenuated interface.

### 4. Storage & Configuration
We use a unified, SQLite-backed configuration provider.

- **`sqlite` Provider:** Wraps `better-sqlite3`. Grants partition-scoped database access to consumers.
- **`config` Provider:** Uses `sqlite` to persist secrets and settings.
  - Providers can register schemas (e.g. `github` registers that it needs a `token`).
  - The Config UI dynamically generates forms to satisfy these schemas.

### 5. User Interface
The system includes a single-pane-of-glass Dashboard and autonomous Provider panels.

- **React SPAs:** UIs are built with React, Vite, and TailwindCSS v4.
- **Subdomain Routing:** The daemon routes traffic using the Host header (e.g., `dashboard.localhost:3000`, `github.localhost:3000`).
- **Same-Origin Isolation:** Using subdomains ensures browser-level isolation (Local Storage, Cookies, JS Contexts) between provider interfaces.
- **exoRpc:** The frontend communicates with the backend via a `/rpc` endpoint, sending serialized `exoeval` closures that map directly to the `@tool()` methods.
- **Generic Mount:** A unified `provider-mount.tsx` template eliminates boilerplate by dynamically importing the correct UI panel based on the HTML metadata injected by the Hono server.

## Build Process

| Step       | Tool    | Input                        | Output                              |
|------------|---------|------------------------------|-------------------------------------|
| BE Bundles | esbuild | `src/providers/*/index.ts`   | `dist/providers/*/index.js`         |
| BE Types   | tsgo    | `src/providers/*/index.ts`   | `dist/providers/*/index.d.ts`       |
| FE Assets  | Vite    | `src/ui/*/index.html`        | `dist/ui/*/`                        |

In development, Vite runs in strict asset mode alongside the backend's Hono server to provide HMR, while esbuild runs in watch mode to hot-reload provider logic.
