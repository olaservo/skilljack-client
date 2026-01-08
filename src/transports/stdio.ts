/**
 * Stdio Transport - Connect to local process MCP servers
 *
 * Usage:
 *   import { createStdioTransport } from './transports/stdio.js';
 *
 *   const transport = createStdioTransport('node', ['server.js']);
 *   await client.connect(transport);
 */

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Create a stdio transport for a local server process.
 */
export function createStdioTransport(
  command: string,
  args: string[] = [],
  env?: Record<string, string>
): StdioClientTransport {
  // Filter out undefined values from process.env and merge with custom env
  const mergedEnv = env
    ? Object.fromEntries(
        Object.entries({ ...process.env, ...env }).filter(
          (entry): entry is [string, string] => entry[1] !== undefined
        )
      )
    : undefined;

  return new StdioClientTransport({
    command,
    args,
    env: mergedEnv,
  });
}

/**
 * Create a stdio transport for a Python server.
 * Uses python3 on Unix, python on Windows.
 */
export function createPythonTransport(
  scriptPath: string,
  args: string[] = [],
  env?: Record<string, string>
): StdioClientTransport {
  const command = process.platform === 'win32' ? 'python' : 'python3';
  return createStdioTransport(command, [scriptPath, ...args], env);
}
