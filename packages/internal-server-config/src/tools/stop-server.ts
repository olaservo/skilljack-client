/**
 * Stop Server Tool Definition
 */
import { z } from 'zod';

export const StopServerSchema = z.object({
  name: z.string().describe('Name of the server to stop'),
});

export const STOP_SERVER_NAME = 'server-config__stop-server';

export const STOP_SERVER_TOOL = {
  name: STOP_SERVER_NAME,
  displayName: 'stop-server',
  title: 'Stop Server',
  description: 'Stop a running MCP server. The server can be started again later.',
  inputSchema: StopServerSchema,
  hasUi: false,
  serverName: 'server-config',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;
