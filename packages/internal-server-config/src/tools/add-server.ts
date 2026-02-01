/**
 * Add Server Tool Definition
 */
import { z } from 'zod';

export const AddServerSchema = z.object({
  name: z.string().describe('Unique name for the server (e.g., "filesystem", "github")'),
  command: z.string().describe('Command to run (e.g., "npx", "node", "python")'),
  args: z
    .array(z.string())
    .optional()
    .describe('Command arguments (e.g., ["-y", "@modelcontextprotocol/server-filesystem", "/home"])'),
  env: z
    .record(z.string())
    .optional()
    .describe('Environment variables (e.g., {"GITHUB_TOKEN": "..."})'),
});

export const ADD_SERVER_NAME = 'server-config__add-server';

export const ADD_SERVER_TOOL = {
  name: ADD_SERVER_NAME,
  displayName: 'add-server',
  title: 'Add Server',
  description: 'Add a new MCP server connection. The server will be started automatically after adding.',
  inputSchema: AddServerSchema,
  hasUi: false,
  serverName: 'server-config',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
} as const;
