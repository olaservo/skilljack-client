/**
 * IPC Channel Constants
 *
 * Defines all valid IPC channels for communication between
 * Electron main process and renderer process.
 *
 * These are the ONLY channels allowed in the preload script's
 * contextBridge whitelist for security.
 */

// ============================================
// Server Management Channels
// ============================================

/** Get list of connected MCP servers */
export const GET_SERVERS = 'mcp:get-servers';

/** Get server configuration */
export const GET_CONFIG = 'mcp:get-config';

// ============================================
// Tool Channels
// ============================================

/** Get list of available tools (with optional hasUi filter) */
export const GET_TOOLS = 'mcp:get-tools';

/** Call a tool by qualified name */
export const CALL_TOOL = 'mcp:call-tool';

/** Get all tools with enabled state (for tool manager) */
export const GET_TOOL_MANAGER_TOOLS = 'mcp:get-tool-manager-tools';

/** Set tool enabled state */
export const SET_TOOL_ENABLED = 'mcp:set-tool-enabled';

/** Get servers with state (for tool manager) */
export const GET_TOOL_MANAGER_SERVERS = 'mcp:get-tool-manager-servers';

/** Set server enabled state */
export const SET_SERVER_ENABLED = 'mcp:set-server-enabled';

// ============================================
// Resource Channels
// ============================================

/** Get list of available resources */
export const GET_RESOURCES = 'mcp:get-resources';

/** Read a specific resource */
export const READ_RESOURCE = 'mcp:read-resource';

/** Fetch UI resource HTML */
export const GET_UI_RESOURCE = 'mcp:get-ui-resource';

// ============================================
// Prompt Channels
// ============================================

/** Get list of available prompts */
export const GET_PROMPTS = 'mcp:get-prompts';

// ============================================
// Chat Channels
// ============================================

/** Start a streaming chat request */
export const CHAT_STREAM_START = 'mcp:chat-stream-start';

/** Receive streaming chat events */
export const CHAT_STREAM_EVENT = 'mcp:chat-stream-event';

/** Cancel an ongoing chat stream */
export const CHAT_STREAM_CANCEL = 'mcp:chat-stream-cancel';

// ============================================
// Lifecycle Management Channels
// ============================================

/** Get all server lifecycle states */
export const GET_SERVER_LIFECYCLE_STATES = 'mcp:get-server-lifecycle-states';

/** Restart a specific server */
export const RESTART_SERVER = 'mcp:restart-server';

/** Stop a specific server */
export const STOP_SERVER = 'mcp:stop-server';

/** Start a specific server */
export const START_SERVER = 'mcp:start-server';

// ============================================
// Event Channels (main → renderer)
// ============================================

/** Notifies renderer when tools list changes */
export const ON_TOOLS_CHANGED = 'mcp:on-tools-changed';

/** Notifies renderer when servers change */
export const ON_SERVERS_CHANGED = 'mcp:on-servers-changed';

/** Notifies renderer of a resource update */
export const ON_RESOURCE_UPDATED = 'mcp:on-resource-updated';

/** Notifies renderer of connection errors */
export const ON_CONNECTION_ERROR = 'mcp:on-connection-error';

// ============================================
// Lifecycle Event Channels (main → renderer)
// ============================================

/** Notifies renderer when a server's status changes */
export const ON_SERVER_STATUS_CHANGED = 'mcp:on-server-status-changed';

/** Notifies renderer when a server becomes healthy */
export const ON_SERVER_HEALTHY = 'mcp:on-server-healthy';

/** Notifies renderer when a server becomes unhealthy */
export const ON_SERVER_UNHEALTHY = 'mcp:on-server-unhealthy';

/** Notifies renderer when a server crashes */
export const ON_SERVER_CRASHED = 'mcp:on-server-crashed';

/** Notifies renderer when a server is restarting */
export const ON_SERVER_RESTARTING = 'mcp:on-server-restarting';

/** Notifies renderer when manager is ready */
export const ON_MANAGER_READY = 'mcp:on-manager-ready';

// ============================================
// Settings Channels
// ============================================

/** Get persisted settings */
export const GET_SETTINGS = 'app:get-settings';

/** Save settings */
export const SET_SETTINGS = 'app:set-settings';

// ============================================
// Window Channels
// ============================================

/** Minimize window */
export const WINDOW_MINIMIZE = 'window:minimize';

/** Maximize/restore window */
export const WINDOW_MAXIMIZE = 'window:maximize';

/** Close window */
export const WINDOW_CLOSE = 'window:close';

// ============================================
// Channel Lists (for preload whitelist)
// ============================================

/** Channels that renderer can invoke (request-response) */
export const INVOKE_CHANNELS = [
  GET_SERVERS,
  GET_CONFIG,
  GET_TOOLS,
  CALL_TOOL,
  GET_TOOL_MANAGER_TOOLS,
  SET_TOOL_ENABLED,
  GET_TOOL_MANAGER_SERVERS,
  SET_SERVER_ENABLED,
  GET_RESOURCES,
  READ_RESOURCE,
  GET_UI_RESOURCE,
  GET_PROMPTS,
  CHAT_STREAM_START,
  CHAT_STREAM_CANCEL,
  GET_SETTINGS,
  SET_SETTINGS,
  WINDOW_MINIMIZE,
  WINDOW_MAXIMIZE,
  WINDOW_CLOSE,
  // Lifecycle management
  GET_SERVER_LIFECYCLE_STATES,
  RESTART_SERVER,
  STOP_SERVER,
  START_SERVER,
] as const;

/** Channels that renderer can listen to (main → renderer events) */
export const ON_CHANNELS = [
  CHAT_STREAM_EVENT,
  ON_TOOLS_CHANGED,
  ON_SERVERS_CHANGED,
  ON_RESOURCE_UPDATED,
  ON_CONNECTION_ERROR,
  // Lifecycle events
  ON_SERVER_STATUS_CHANGED,
  ON_SERVER_HEALTHY,
  ON_SERVER_UNHEALTHY,
  ON_SERVER_CRASHED,
  ON_SERVER_RESTARTING,
  ON_MANAGER_READY,
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
export type OnChannel = (typeof ON_CHANNELS)[number];
