export { createDenoSandbox } from './code-mode-deno.js'
export { CodeMode } from './code-mode.js'
export type { SafeEvalContext, SafeEvalResult } from './code-mode.js'

// RPC toolset for Cap'n Web integration
export { RpcToolset, tool } from './rpc-toolset.js'
export type { ToolCallback } from './rpc-toolset.js'

// SQL query builder
export { Database } from './sql/builder.js'
export type { TableClass } from './sql/builder.js'

// Re-export capnweb to avoid duplicate module issues
export { newWebSocketRpcSession, newWorkersRpcResponse } from 'capnweb'
