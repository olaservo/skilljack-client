/**
 * Manage Tools Tool Definition
 *
 * This tool opens the tool manager UI for browsing and toggling tools.
 */
import { z } from 'zod';

// Tool input schema (no parameters needed)
export const ManageToolsSchema = z.object({});

// Tool name constant
export const MANAGE_TOOLS_NAME = 'tool-manager__manage-tools';

// UI resource URI
export const TOOL_MANAGER_UI_URI = 'builtin://tool-manager';

// Tool configuration
export const MANAGE_TOOLS_TOOL = {
  name: MANAGE_TOOLS_NAME,
  displayName: 'manage-tools',
  title: 'Manage Tools',
  description:
    'SHOW or DISPLAY the tool manager UI. Use when user wants to SEE, VIEW, or SHOW available tools. Opens a visual panel to browse and toggle tools on/off.',
  inputSchema: ManageToolsSchema,
  hasUi: true,
  uiResourceUri: TOOL_MANAGER_UI_URI,
  serverName: 'tool-manager',
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
} as const;
