/**
 * Standalone HTTP server for dev mode (no Electron)
 */

import express from 'express'
import cors from 'cors'
import { createHttpMiddleware, getHandlers } from './transport'
import { registerHandlers } from './handlers'

const PORT = process.env.PORT || 3001

// Register all handlers
registerHandlers()

const app = express()
app.use(cors())
app.use(express.json())

// Mount transport middleware
app.use('/rpc', createHttpMiddleware())

// Debug: list registered routes
console.log('Registered handlers:')
for (const channel of getHandlers().keys()) {
  console.log(`  POST /rpc/${channel}`)
}

app.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`)
})
