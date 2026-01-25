/**
 * Start Server Tool Definition
 */
import { z } from 'zod';

export const StartServerSchema = z.object({
  name: z.string().describe('Name of the server to start'),
});

export const START_SERVER_NAME = 'server-config__start-server';

export const START_SERVER_TOOL = {
  name: START_SERVER_NAME,
  displayName: 'start-server',
  title: 'Start Server',
  description: 'Start a stopped MCP server.',
  inputSchema: StartServerSchema,
  hasUi: false,
  serverName: 'server-config',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;
