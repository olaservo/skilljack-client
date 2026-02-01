/**
 * Install MCPB Tool Definition
 */
import { z } from 'zod';

export const InstallMcpbSchema = z.object({
  mcpbPath: z.string().describe('Absolute path to the .mcpb file to install'),
});

export const INSTALL_MCPB_NAME = 'server-config__install-mcpb';

export const MCPB_CONFIRM_UI_URI = 'builtin://mcpb-confirm';

export const INSTALL_MCPB_TOOL = {
  name: INSTALL_MCPB_NAME,
  displayName: 'install-mcpb',
  title: 'Install MCPB',
  description:
    'Install an MCP server from an MCPB (MCP Bundle) file. Shows extension details and asks for confirmation before installing.',
  inputSchema: InstallMcpbSchema,
  hasUi: true,
  uiResourceUri: MCPB_CONFIRM_UI_URI,
  serverName: 'server-config',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
} as const;
