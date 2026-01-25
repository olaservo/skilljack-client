/**
 * Tool definitions for internal-tool-manager
 */
export {
  ManageToolsSchema,
  MANAGE_TOOLS_NAME,
  MANAGE_TOOLS_TOOL,
  TOOL_MANAGER_UI_URI,
} from './manage-tools.js';

// All tools as an array (useful for registration)
import { MANAGE_TOOLS_TOOL } from './manage-tools.js';

export const ALL_TOOL_MANAGER_TOOLS = [MANAGE_TOOLS_TOOL] as const;
