/**
 * List Servers Tool Definition
 */
import { z } from 'zod';

export const ListServersSchema = z.object({});

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
