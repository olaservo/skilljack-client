/**
 * Remove Server Tool Definition
 */
import { z } from 'zod';

export const RemoveServerSchema = z.object({
  name: z.string().describe('Name of the server to remove'),
});

export const REMOVE_SERVER_NAME = 'server-config__remove-server';

export const REMOVE_SERVER_TOOL = {
  name: REMOVE_SERVER_NAME,
  displayName: 'remove-server',
  title: 'Remove Server',
  description: 'Remove an MCP server from the configuration. The server will be disconnected.',
  inputSchema: RemoveServerSchema,
  hasUi: false,
  serverName: 'server-config',
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;
