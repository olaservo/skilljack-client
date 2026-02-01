/**
 * @skilljack/internal-tool-manager
 *
 * Built-in tool manager for MCP clients.
 * Dual-use: Can run as a standalone MCP server or be imported as a package.
 */

// Tool definitions and schemas
export {
  ManageToolsSchema,
  MANAGE_TOOLS_NAME,
  MANAGE_TOOLS_TOOL,
  TOOL_MANAGER_UI_URI,
  ALL_TOOL_MANAGER_TOOLS,
} from './tools/index.js';

// Handlers
export { handleManageTools, createToolManagerHandler } from './handlers.js';

// UI loaders
export { getToolManagerUI, clearUICache } from './ui/index.js';

// Server factory for standalone mode
export { createServer } from './server.js';
