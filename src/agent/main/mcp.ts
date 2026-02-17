#!/usr/bin/env node
/**
 * MCP server for testing the chat interface
 *
 * This exposes the chat agent over MCP stdio transport for isolated testing.
 * Uses the same handlers as HTTP/IPC but with API key from environment.
 *
 * Tools:
 * - threads_create: Create a new thread, returns { id }
 * - chat: Send a message on a thread (threadId, message)
 *
 * Usage:
 *   GEMINI_API_KEY=... npx tsx src/agent/main/mcp.ts
 */

// Register ArrayValue factory FIRST before any other imports
import { registerArrayValueFactory } from '../../eval'
registerArrayValueFactory()

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { handleChat, handleThreadsCreate } from './handlers'

// Get API key from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is required')
  process.exit(1)
}

// Create MCP server
const server = new McpServer({
  name: 'exoagent-test',
  version: '1.0.0',
})

// threads_create
server.registerTool('threads_create', {
  description: 'Create a new thread',
  inputSchema: {},
}, async () => {
  const result = await handleThreadsCreate()
  return {
    content: [{ type: 'text', text: `Created thread: ${result.id}` }],
    structuredContent: result,
  }
})

// chat
server.registerTool('chat', {
  description: 'Send a message to the agent on a thread',
  inputSchema: {
    threadId: z.string().describe('The thread ID'),
    message: z.string().describe('The message to send'),
  },
}, async ({ threadId, message }) => {
  try {
    const result = await handleChat(threadId, message, GEMINI_API_KEY)
    return {
      content: [{ type: 'text', text: result.response }],
      structuredContent: result,
    }
  }
  catch (err) {
    const error = err as Error & { code?: string }
    const codeBlock = error.code ? `\n\nCode:\n${error.code}` : ''
    return {
      content: [{ type: 'text', text: `Error: ${error.message}${codeBlock}` }],
      structuredContent: { error: error.message, stack: error.stack, code: error.code },
      isError: true,
    }
  }
})

// Start server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('ExoAgent MCP test server running on stdio')
}

main().catch((error) => {
  console.error('Server error:', error)
  process.exit(1)
})
