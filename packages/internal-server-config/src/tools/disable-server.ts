/**
 * Disable Server Tool Definition
 */
import { z } from 'zod';

export const DisableServerSchema = z.object({
  name: z.string().describe('Name of the server to disable'),
});

export const DISABLE_SERVER_NAME = 'server-config__disable-server';

export const DISABLE_SERVER_TOOL = {
  name: DISABLE_SERVER_NAME,
  displayName: 'disable-server',
  title: 'Disable Server',
  description:
    "Disable an MCP server. When disabled, the server's tools will not be available for use.",
  inputSchema: DisableServerSchema,
  hasUi: false,
  serverName: 'server-config',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;
