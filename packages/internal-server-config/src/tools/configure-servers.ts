/**
 * Configure Servers Tool Definition
 *
 * This tool opens the server configuration UI.
 */
import { z } from 'zod';

// Tool input schema (no parameters needed)
export const ConfigureServersSchema = z.object({});

// Tool name constant
export const CONFIGURE_SERVERS_NAME = 'server-config__configure-servers';

// UI resource URI (ui:// scheme per the MCP Apps extension spec)
export const SERVER_CONFIG_UI_URI = 'ui://server-config/mcp-app.html';

// Tool configuration
export const CONFIGURE_SERVERS_TOOL = {
  name: CONFIGURE_SERVERS_NAME,
  displayName: 'configure-servers',
  title: 'Configure Servers',
  description:
    'SHOW or DISPLAY the server configuration UI. Use when user wants to SEE, VIEW, or SHOW server connections. Opens a visual panel to manage servers.',
  inputSchema: ConfigureServersSchema,
  hasUi: true,
  uiResourceUri: SERVER_CONFIG_UI_URI,
  serverName: 'server-config',
  // Standard MCP Apps tool→resource linkage (SEP-1865)
  _meta: { ui: { resourceUri: SERVER_CONFIG_UI_URI } },
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
} as const;
