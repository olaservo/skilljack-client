/**
 * Enable Server Tool Definition
 */
import { z } from 'zod';

export const EnableServerSchema = z.object({
  name: z.string().describe('Name of the server to enable'),
});

export const ENABLE_SERVER_NAME = 'server-config__enable-server';

export const ENABLE_SERVER_TOOL = {
  name: ENABLE_SERVER_NAME,
  displayName: 'enable-server',
  title: 'Enable Server',
  description:
    "Enable a disabled MCP server. When enabled, the server's tools become available for use.",
  inputSchema: EnableServerSchema,
  hasUi: false,
  serverName: 'server-config',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;
