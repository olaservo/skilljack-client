/**
 * Restart Server Tool Definition
 */
import { z } from 'zod';

export const RestartServerSchema = z.object({
  name: z.string().describe('Name of the server to restart'),
});

export const RESTART_SERVER_NAME = 'server-config__restart-server';

export const RESTART_SERVER_TOOL = {
  name: RESTART_SERVER_NAME,
  displayName: 'restart-server',
  title: 'Restart Server',
  description:
    'Restart an MCP server. Useful when a server becomes unresponsive or after configuration changes.',
  inputSchema: RestartServerSchema,
  hasUi: false,
  serverName: 'server-config',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;
