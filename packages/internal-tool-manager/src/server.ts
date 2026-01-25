/**
 * Server factory for running internal-tool-manager as a standalone MCP server.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MANAGE_TOOLS_TOOL, TOOL_MANAGER_UI_URI } from './tools/index.js';
import { handleManageTools } from './handlers.js';
import { getToolManagerUI } from './ui/index.js';

// Schema for standalone server registration
const ManageToolsInputSchema = z.object({});

// Tool configuration (following everything server pattern)
const manageToolsConfig = {
  title: 'Manage Tools',
  description: MANAGE_TOOLS_TOOL.description,
  inputSchema: ManageToolsInputSchema,
};

export interface ServerFactoryResponse {
  server: McpServer;
  cleanup: () => void;
}

/**
 * Creates a standalone MCP server for the tool manager.
 *
 * Note: In standalone mode, the tool manager has limited functionality
 * since it cannot access external MCP servers. It primarily demonstrates
 * the UI and tool structure.
 */
export function createServer(): ServerFactoryResponse {
  const server = new McpServer(
    {
      name: 'internal-tool-manager',
      title: 'Tool Manager',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: { subscribe: false, listChanged: false },
      },
      instructions:
        'This server provides a tool manager UI for browsing and toggling MCP tools. ' +
        'In standalone mode, it cannot manage external servers.',
    }
  );

  // Register the manage-tools tool
  // Using type assertion to avoid TypeScript type recursion issue with SDK generics
  (server.registerTool as Function)(
    'manage-tools',
    manageToolsConfig,
    async (args: unknown): Promise<CallToolResult> => {
      ManageToolsInputSchema.parse(args);
      return handleManageTools();
    }
  );

  // Register the UI resource
  server.registerResource(
    'tool-manager-ui',
    TOOL_MANAGER_UI_URI,
    {
      description: 'HTML UI for managing tools',
      mimeType: 'text/html;mcp-app',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/html;mcp-app',
          text: getToolManagerUI(),
        },
      ],
    })
  );

  return {
    server,
    cleanup: () => {
      // No cleanup needed for this simple server
    },
  };
}
