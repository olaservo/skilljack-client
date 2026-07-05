/**
 * List Servers Tool Definition
 */
import { z } from 'zod';

export const ListServersSchema = z.object({});

/** Structured output for list-servers (drives structuredContent in results) */
export const ListServersOutputSchema = z.object({
  servers: z.array(
    z.object({
      name: z.string().describe('Server name'),
      status: z.string().describe('Runtime connection status'),
      enabled: z
        .boolean()
        .describe('Whether the server\'s tools are exposed to models and agents'),
      toolCount: z.number().describe('Number of tools provided by this server'),
      lastError: z.string().optional().describe('Last error message, if any'),
    })
  ),
});

export const LIST_SERVERS_NAME = 'server-config__list-servers';

export const LIST_SERVERS_TOOL = {
  name: LIST_SERVERS_NAME,
  displayName: 'list-servers',
  title: 'List Servers',
  description:
    'Get server status as text data. Use for checking connection status programmatically. If user wants to SEE/SHOW/VIEW servers visually, use configure-servers instead.',
  inputSchema: ListServersSchema,
  hasUi: false,
  serverName: 'server-config',
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
} as const;
