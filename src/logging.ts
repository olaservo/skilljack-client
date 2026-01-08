/**
 * Client-side logging abstraction for MCP Reference Client
 *
 * Routes output to stderr when in stdio mode to avoid corrupting the JSON-RPC protocol stream.
 * In stdio transport mode, stdout is reserved for protocol messages only.
 */

let useStderr = false;

/**
 * Enable stdio mode - routes all output to stderr instead of stdout
 */
export function setStdioMode(enabled: boolean): void {
  useStderr = enabled;
}

/**
 * Check if stdio mode is enabled
 */
export function isStdioMode(): boolean {
  return useStderr;
}

/**
 * Log a message (routes to stderr in stdio mode)
 */
export function log(...args: unknown[]): void {
  if (useStderr) {
    console.error(...args);
  } else {
    console.log(...args);
  }
}

/**
 * Log a warning message (always goes to stderr)
 */
export function logWarn(...args: unknown[]): void {
  console.warn(...args);
}

/**
 * Log an error message (always goes to stderr)
 */
export function logError(...args: unknown[]): void {
  console.error(...args);
}
