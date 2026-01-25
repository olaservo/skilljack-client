/**
 * Tool call handlers for internal-tool-manager
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MANAGE_TOOLS_NAME } from './tools/index.js';

/**
 * Handle the manage-tools tool call.
 * This tool simply indicates that the UI should be shown.
 */
export function handleManageTools(): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: 'Tool manager opened.',
        annotations: { audience: ['user'], priority: 0.7 },
      },
    ],
  };
}

/**
 * Create a handler function for tool-manager tools.
 * Returns the result if handled, or null if not a tool-manager tool.
 */
export function createToolManagerHandler() {
  return (toolName: string, _args: Record<string, unknown>): CallToolResult | null => {
    if (toolName === MANAGE_TOOLS_NAME) {
      return handleManageTools();
    }
    return null;
  };
}
