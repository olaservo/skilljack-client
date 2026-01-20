/**
 * MCP Apps Module
 *
 * Provides React components for rendering MCP App tool UIs in Electron mode.
 * Uses the double-iframe security model from MCP Apps architecture.
 */

export { McpAppProvider, useMcpApps } from './McpAppContext';
export type { McpAppPanel } from './McpAppContext';
export { McpAppPanelsContainer } from './McpAppPanelsContainer';
export { McpAppPanel as McpAppPanelComponent } from './McpAppPanel';
export {
  createSandboxProxyUrl,
  buildCspMetaTag,
  prepareAppHtml,
  MessageTypes,
  createJsonRpcResponse,
  createJsonRpcError,
  createJsonRpcNotification,
} from './sandbox-proxy';
