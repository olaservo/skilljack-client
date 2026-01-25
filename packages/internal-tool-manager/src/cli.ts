#!/usr/bin/env node
/**
 * CLI entry point for running internal-tool-manager as a standalone MCP server.
 *
 * Usage:
 *   npx @skilljack/internal-tool-manager
 *   node dist/cli.js
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main() {
  const { server, cleanup } = createServer();
  const transport = new StdioServerTransport();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.error('[Tool Manager] Shutting down...');
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[Tool Manager] Shutting down...');
    cleanup();
    process.exit(0);
  });

  // Connect and start serving
  await server.connect(transport);
  console.error('[Tool Manager] MCP server running via stdio');
}

main().catch((err) => {
  console.error('[Tool Manager] Fatal error:', err);
  process.exit(1);
});
