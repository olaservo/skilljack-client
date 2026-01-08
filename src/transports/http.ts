/**
 * HTTP Transport - Connect to remote MCP servers
 *
 * Usage:
 *   import { createHttpTransport } from './transports/http.js';
 *
 *   const transport = createHttpTransport('http://localhost:3000/mcp');
 *   await client.connect(transport);
 */

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Create an HTTP transport for a remote server.
 */
export function createHttpTransport(
  url: string,
  headers?: Record<string, string>
): StreamableHTTPClientTransport {
  const options: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] = {};

  if (headers) {
    options.requestInit = { headers };
  }

  return new StreamableHTTPClientTransport(new URL(url), options);
}

/**
 * Create an HTTP transport with Bearer token authentication.
 */
export function createAuthenticatedTransport(
  url: string,
  token: string
): StreamableHTTPClientTransport {
  return createHttpTransport(url, {
    Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
  });
}
