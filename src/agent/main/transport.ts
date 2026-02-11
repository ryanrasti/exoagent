/**
 * Transport abstraction for IPC/HTTP
 *
 * In Electron: uses ipcMain.handle
 * In dev mode: uses Express HTTP server
 */

import type { RequestHandler } from 'express'

type Handler = (args: unknown[]) => Promise<unknown>

const handlers = new Map<string, Handler>()

/**
 * Register a handler for a channel/route.
 * Works like ipcMain.handle but also exposes as HTTP in dev mode.
 */
export function handle(channel: string, handler: (...args: unknown[]) => Promise<unknown>): void {
  handlers.set(channel, (args) => handler(...args))
}

/**
 * Get all registered handlers (for HTTP server setup)
 */
export function getHandlers(): Map<string, Handler> {
  return handlers
}

/**
 * Setup IPC handlers in Electron
 */
export function setupElectronIpc(): void {
  // Dynamic import to avoid requiring electron in non-electron context
  import('electron').then(({ ipcMain }) => {
    for (const [channel, handler] of handlers) {
      ipcMain.handle(channel, async (_, ...args) => {
        return handler(args)
      })
    }
  })
}

/**
 * Create Express middleware for HTTP transport
 */
export function createHttpMiddleware(): RequestHandler {
  return async (req, res, next) => {
    // Route format: POST /<channel>
    const channel = req.path.slice(1) // Remove leading /

    const handler = handlers.get(channel)
    if (!handler) {
      return next()
    }

    try {
      // Args come as JSON array in body
      const args = Array.isArray(req.body) ? req.body : [req.body]
      const result = await handler(args)
      res.json({ ok: true, result })
    }
    catch (err) {
      const error = err instanceof Error
        ? { message: err.message, stack: err.stack }
        : { message: String(err) }
      res.status(500).json({ ok: false, error })
    }
  }
}
