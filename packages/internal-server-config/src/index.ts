/**
 * @skilljack/internal-server-config
 *
 * Built-in server configuration tools for MCP clients.
 * Dual-use: Can run as a standalone MCP server or be imported as a package.
 */

// Tool definitions and schemas
export {
  // Main UI tool
  ConfigureServersSchema,
  CONFIGURE_SERVERS_NAME,
  CONFIGURE_SERVERS_TOOL,
  SERVER_CONFIG_UI_URI,
  SERVER_CONFIG_TOOL,

  // Action tools
  ListServersSchema,
  LIST_SERVERS_NAME,
  LIST_SERVERS_TOOL,
  AddServerSchema,
  ADD_SERVER_NAME,
  ADD_SERVER_TOOL,
  RemoveServerSchema,
  REMOVE_SERVER_NAME,
  REMOVE_SERVER_TOOL,
  RestartServerSchema,
  RESTART_SERVER_NAME,
  RESTART_SERVER_TOOL,
  StopServerSchema,
  STOP_SERVER_NAME,
  STOP_SERVER_TOOL,
  StartServerSchema,
  START_SERVER_NAME,
  START_SERVER_TOOL,
  EnableServerSchema,
  ENABLE_SERVER_NAME,
  ENABLE_SERVER_TOOL,
  DisableServerSchema,
  DISABLE_SERVER_NAME,
  DISABLE_SERVER_TOOL,
  InstallMcpbSchema,
  INSTALL_MCPB_NAME,
  INSTALL_MCPB_TOOL,
  MCPB_CONFIRM_UI_URI,

  // Tool arrays
  SERVER_CONFIG_ACTION_TOOLS,
  ALL_SERVER_CONFIG_TOOLS,
} from './tools/index.js';

// Handlers
export {
  createServerConfigHandler,
  type ServerConfigDeps,
  type ServerConfigWithStatus,
  type HandlerResult,
} from './handlers.js';

// UI loaders
export { getServerConfigUI, getMcpbConfirmUI, clearUICache } from './ui/index.js';

// Server factory for standalone mode
export { createServer } from './server.js';
