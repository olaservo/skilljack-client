/**
 * Tool definitions for internal-server-config
 */

// UI tool
export {
  ConfigureServersSchema,
  CONFIGURE_SERVERS_NAME,
  CONFIGURE_SERVERS_TOOL,
  SERVER_CONFIG_UI_URI,
} from './configure-servers.js';

// Action tools
export { ListServersSchema, LIST_SERVERS_NAME, LIST_SERVERS_TOOL } from './list-servers.js';
export { AddServerSchema, ADD_SERVER_NAME, ADD_SERVER_TOOL } from './add-server.js';
export { RemoveServerSchema, REMOVE_SERVER_NAME, REMOVE_SERVER_TOOL } from './remove-server.js';
export { RestartServerSchema, RESTART_SERVER_NAME, RESTART_SERVER_TOOL } from './restart-server.js';
export { StopServerSchema, STOP_SERVER_NAME, STOP_SERVER_TOOL } from './stop-server.js';
export { StartServerSchema, START_SERVER_NAME, START_SERVER_TOOL } from './start-server.js';
export { EnableServerSchema, ENABLE_SERVER_NAME, ENABLE_SERVER_TOOL } from './enable-server.js';
export { DisableServerSchema, DISABLE_SERVER_NAME, DISABLE_SERVER_TOOL } from './disable-server.js';
export {
  InstallMcpbSchema,
  INSTALL_MCPB_NAME,
  INSTALL_MCPB_TOOL,
  MCPB_CONFIRM_UI_URI,
} from './install-mcpb.js';

// Import for arrays
import { CONFIGURE_SERVERS_TOOL } from './configure-servers.js';
import { LIST_SERVERS_TOOL } from './list-servers.js';
import { ADD_SERVER_TOOL } from './add-server.js';
import { REMOVE_SERVER_TOOL } from './remove-server.js';
import { RESTART_SERVER_TOOL } from './restart-server.js';
import { STOP_SERVER_TOOL } from './stop-server.js';
import { START_SERVER_TOOL } from './start-server.js';
import { ENABLE_SERVER_TOOL } from './enable-server.js';
import { DISABLE_SERVER_TOOL } from './disable-server.js';
import { INSTALL_MCPB_TOOL } from './install-mcpb.js';

// Main UI tool
export const SERVER_CONFIG_TOOL = CONFIGURE_SERVERS_TOOL;

// All action tools (non-UI)
export const SERVER_CONFIG_ACTION_TOOLS = [
  LIST_SERVERS_TOOL,
  ADD_SERVER_TOOL,
  REMOVE_SERVER_TOOL,
  RESTART_SERVER_TOOL,
  STOP_SERVER_TOOL,
  START_SERVER_TOOL,
  ENABLE_SERVER_TOOL,
  DISABLE_SERVER_TOOL,
  INSTALL_MCPB_TOOL,
] as const;

// All tools combined
export const ALL_SERVER_CONFIG_TOOLS = [
  CONFIGURE_SERVERS_TOOL,
  ...SERVER_CONFIG_ACTION_TOOLS,
] as const;
