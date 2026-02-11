/**
 * IPC setup for Electron - thin wrapper over transport
 */

import { registerHandlers } from './handlers'
import { setupElectronIpc } from './transport'

// Re-export types from handlers
export type { Turn, LLMContext, LLMCapabilities, LLMOptions, LLMResult } from './handlers'
export { llm } from './handlers'

export function setupIpc(): void {
  // Register all handlers with transport
  registerHandlers()
  // Wire up to Electron IPC
  setupElectronIpc()
}
