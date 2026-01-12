/**
 * Tool Manager State
 *
 * Manages the enabled/disabled state of tools and servers.
 * Tools are identified by their qualified name (server__tool).
 */

/** Tool info with enabled state */
export interface ToolWithState {
  name: string;
  displayName: string;
  description?: string;
  serverName: string;
  hasUi: boolean;
  uiResourceUri?: string;
  enabled: boolean;
}

/** Server info with enabled state */
export interface ServerWithState {
  name: string;
  toolCount: number;
  enabled: boolean;
}

// In-memory state for disabled tools and servers
const disabledTools = new Set<string>();
const disabledServers = new Set<string>();

/**
 * Check if a server is enabled
 */
export function isServerEnabled(serverName: string): boolean {
  return !disabledServers.has(serverName);
}

/**
 * Set the enabled state of a server
 */
export function setServerEnabled(serverName: string, enabled: boolean): void {
  if (enabled) {
    disabledServers.delete(serverName);
  } else {
    disabledServers.add(serverName);
  }
}

/**
 * Get all disabled server names
 */
export function getDisabledServers(): string[] {
  return Array.from(disabledServers);
}

/**
 * Check if a tool is enabled (considers both tool and server state)
 */
export function isToolEnabled(qualifiedName: string): boolean {
  // Check if the tool's server is disabled
  const serverName = qualifiedName.split('__')[0];
  if (disabledServers.has(serverName)) {
    return false;
  }
  return !disabledTools.has(qualifiedName);
}

/**
 * Set the enabled state of a tool
 */
export function setToolEnabled(qualifiedName: string, enabled: boolean): void {
  if (enabled) {
    disabledTools.delete(qualifiedName);
  } else {
    disabledTools.add(qualifiedName);
  }
}

/**
 * Get all disabled tool names
 */
export function getDisabledTools(): string[] {
  return Array.from(disabledTools);
}

/**
 * Add enabled state to a list of tools
 */
export function addEnabledState<T extends { name: string }>(tools: T[]): (T & { enabled: boolean })[] {
  return tools.map((tool) => ({
    ...tool,
    enabled: isToolEnabled(tool.name),
  }));
}

/**
 * Filter to only enabled tools
 */
export function filterEnabledTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((tool) => isToolEnabled(tool.name));
}

/**
 * Get servers with their enabled state and tool counts
 */
export function getServersWithState<T extends { serverName: string }>(tools: T[]): ServerWithState[] {
  const serverToolCounts = new Map<string, number>();
  for (const tool of tools) {
    const count = serverToolCounts.get(tool.serverName) || 0;
    serverToolCounts.set(tool.serverName, count + 1);
  }

  return Array.from(serverToolCounts.entries()).map(([name, toolCount]) => ({
    name,
    toolCount,
    enabled: isServerEnabled(name),
  }));
}
