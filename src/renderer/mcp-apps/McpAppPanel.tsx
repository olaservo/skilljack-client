/**
 * MCP App Panel Component
 *
 * Renders a single MCP App in a sandboxed iframe.
 * Handles JSON-RPC communication between host and app.
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { getCommunicationAdapter } from '../hooks/useCommunication';
import {
  createSandboxProxyUrl,
  MessageTypes,
  createJsonRpcResponse,
  createJsonRpcError,
  createJsonRpcNotification,
} from './sandbox-proxy';
import type { McpAppPanel as McpAppPanelData } from './McpAppContext';

interface McpAppPanelProps {
  panel: McpAppPanelData;
  onClose: () => void;
  isActive?: boolean;
}

/**
 * Get current theme from document
 */
function getCurrentTheme(): 'light' | 'dark' {
  if (
    document.documentElement.classList.contains('dark') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

/**
 * Extract CSS variables from the document
 */
function getCssVariables(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const variables: Record<string, string> = {};
  const varNames = [
    '--primary-color',
    '--secondary-color',
    '--background',
    '--foreground',
    '--text-color',
    '--border-color',
    '--accent-color',
    '--error-color',
    '--success-color',
    '--warning-color',
    '--muted-color',
    '--bg-primary',
    '--bg-secondary',
    '--text-primary',
    '--text-secondary',
  ];
  for (const name of varNames) {
    const value = styles.getPropertyValue(name).trim();
    if (value) {
      variables[name] = value;
    }
  }
  return variables;
}

export function McpAppPanel({ panel, onClose, isActive = true }: McpAppPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [appInitialized, setAppInitialized] = useState(false);
  const [proxyReady, setProxyReady] = useState(false);
  const [minHeight, setMinHeight] = useState<number | null>(null);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const adapter = getCommunicationAdapter();

  // Track pending tool input/result to send after initialization
  const pendingDataRef = useRef<{
    toolInput: Record<string, unknown>;
    toolResult: unknown;
  } | null>(null);

  // Create sandbox proxy Blob URL on mount
  useEffect(() => {
    const url = createSandboxProxyUrl();
    setSandboxUrl(url);
    console.log('[McpAppPanel] Created sandbox proxy URL');

    // Cleanup blob URL on unmount
    return () => {
      URL.revokeObjectURL(url);
      console.log('[McpAppPanel] Revoked sandbox proxy URL');
    };
  }, []);

  /**
   * Send message to iframe
   */
  const sendToApp = useCallback((message: object) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(message, '*');
    }
  }, []);

  /**
   * Build host context for ui/initialize response
   */
  const buildHostContext = useCallback(() => {
    const toolName = panel.uiResourceUri.split('/').pop() || panel.uiResourceUri;
    return {
      theme: getCurrentTheme(),
      locale: navigator.language,
      toolInfo: {
        name: toolName,
        arguments: panel.toolInput,
      },
      availableDisplayModes: ['inline', 'fullscreen'],
      styles: {
        variables: getCssVariables(),
        css: {},
      },
    };
  }, [panel.uiResourceUri, panel.toolInput]);

  /**
   * Handle messages from iframe (both sandbox proxy and app)
   */
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Only handle messages from our iframe
      if (event.source !== iframeRef.current?.contentWindow) return;

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // Handle JSON-RPC messages
      if (data.jsonrpc === '2.0') {
        // Sandbox proxy is ready - now we can send the app HTML
        if (data.method === MessageTypes.SANDBOX_PROXY_READY) {
          console.log('[McpAppPanel] Sandbox proxy ready');
          setProxyReady(true);
        }

        // App sends ui/initialize request
        if (data.method === MessageTypes.INITIALIZE && data.id) {
          console.log('[McpAppPanel] Received ui/initialize from app:', data.params);
          sendToApp(
            createJsonRpcResponse(data.id, {
              protocolVersion: '2025-01-01',
              hostCapabilities: {
                tools: {},
                resources: {},
              },
              hostInfo: {
                name: 'skilljack-electron',
                version: '0.2.0',
              },
              hostContext: buildHostContext(),
            })
          );
        }

        // App initialized notification - now we can send tool data
        if (data.method === MessageTypes.INITIALIZED) {
          console.log('[McpAppPanel] App initialized');
          setAppInitialized(true);

          // Send tool input
          sendToApp(
            createJsonRpcNotification(MessageTypes.TOOL_INPUT, {
              arguments: panel.toolInput,
            })
          );

          // Send tool result
          sendToApp(createJsonRpcNotification(MessageTypes.TOOL_RESULT, panel.toolResult));
        }

        // App requests to call a tool
        if (data.method === MessageTypes.TOOLS_CALL && data.id) {
          try {
            // Qualify tool name with server name if not already qualified
            let toolName = data.params.name;
            if (!toolName.includes('__') && panel.serverName) {
              toolName = `${panel.serverName}__${toolName}`;
            }

            console.log('[McpAppPanel] Calling tool:', toolName);
            const result = await adapter.callTool(toolName, data.params.arguments || {});

            sendToApp(createJsonRpcResponse(data.id, result));
          } catch (error) {
            console.error('[McpAppPanel] Tool call error:', error);
            sendToApp(
              createJsonRpcError(
                data.id,
                -32603,
                error instanceof Error ? error.message : 'Tool call failed'
              )
            );
          }
        }

        // App sends a message
        if (data.method === MessageTypes.MESSAGE && data.id) {
          console.log('[McpAppPanel] Message from app:', data.params);
          sendToApp(createJsonRpcResponse(data.id, {}));
        }

        // App requests to open a link
        if (data.method === MessageTypes.OPEN_LINK && data.id) {
          window.open(data.params.url, '_blank', 'noopener,noreferrer');
          sendToApp(createJsonRpcResponse(data.id, {}));
        }

        // App sends a log message
        if (data.method === MessageTypes.LOGGING_MESSAGE) {
          console.log(`[App ${data.params.level}]`, data.params.data);
        }

        // App sends size change notification
        if (data.method === MessageTypes.SIZE_CHANGED) {
          const { height } = data.params;
          console.log('[McpAppPanel] Size change:', data.params);
          if (height && height > 0) {
            setMinHeight(height);
          }
        }

        // Legacy size change request
        if (data.method === MessageTypes.SIZE_CHANGED_REQUEST && data.id) {
          const { height } = data.params;
          if (height && height > 0) {
            setMinHeight(height);
          }
          sendToApp(createJsonRpcResponse(data.id, {}));
        }

        // App requests display mode change
        if (data.method === MessageTypes.REQUEST_DISPLAY_MODE && data.id) {
          const { mode } = data.params;
          console.log('[McpAppPanel] Display mode requested:', mode);
          // For now, just acknowledge - full implementation would handle fullscreen
          sendToApp(createJsonRpcResponse(data.id, { mode: 'inline' }));
        }

        // App updates model context
        if (data.method === MessageTypes.MODEL_CONTEXT && data.id) {
          console.log('[McpAppPanel] Model context update:', data.params);
          sendToApp(createJsonRpcResponse(data.id, {}));
        }

        // ============================================
        // Tool Manager specific JSON-RPC methods
        // ============================================

        // Get servers list with enabled state
        if (data.method === 'tool-manager/getServers' && data.id) {
          try {
            const servers = await adapter.getToolManagerServers();
            sendToApp(createJsonRpcResponse(data.id, { servers }));
          } catch (error) {
            console.error('[McpAppPanel] getServers error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, 'Failed to get servers')
            );
          }
        }

        // Get tools list with enabled state
        if (data.method === 'tool-manager/getTools' && data.id) {
          try {
            const tools = await adapter.getToolManagerTools();
            sendToApp(createJsonRpcResponse(data.id, { tools }));
          } catch (error) {
            console.error('[McpAppPanel] getTools error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, 'Failed to get tools')
            );
          }
        }

        // Set server enabled state
        if (data.method === 'tool-manager/setServerEnabled' && data.id) {
          try {
            const { name, enabled } = data.params;
            const result = await adapter.setServerEnabled(name, enabled);
            sendToApp(createJsonRpcResponse(data.id, result));
          } catch (error) {
            console.error('[McpAppPanel] setServerEnabled error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, 'Failed to update server')
            );
          }
        }

        // Set tool enabled state
        if (data.method === 'tool-manager/setToolEnabled' && data.id) {
          try {
            const { name, enabled } = data.params;
            const result = await adapter.setToolEnabled(name, enabled);
            sendToApp(createJsonRpcResponse(data.id, result));
          } catch (error) {
            console.error('[McpAppPanel] setToolEnabled error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, 'Failed to update tool')
            );
          }
        }

        // ============================================
        // Server Config specific JSON-RPC methods
        // ============================================

        // Get server configurations with status
        if (data.method === 'server-config/getServers' && data.id) {
          try {
            const servers = await adapter.getServerConfigs();
            sendToApp(createJsonRpcResponse(data.id, { servers }));
          } catch (error) {
            console.error('[McpAppPanel] server-config/getServers error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, 'Failed to get server configs')
            );
          }
        }

        // Add a new server
        if (data.method === 'server-config/addServer' && data.id) {
          try {
            const { name, command, args, env } = data.params;
            const result = await adapter.addServerConfig({ name, command, args, env });
            sendToApp(createJsonRpcResponse(data.id, result));
          } catch (error) {
            console.error('[McpAppPanel] server-config/addServer error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, error instanceof Error ? error.message : 'Failed to add server')
            );
          }
        }

        // Update server configuration
        if (data.method === 'server-config/updateServer' && data.id) {
          try {
            const { name, command, args, env, enabled } = data.params;
            const result = await adapter.updateServerConfig(name, { command, args, env, enabled });
            sendToApp(createJsonRpcResponse(data.id, result));
          } catch (error) {
            console.error('[McpAppPanel] server-config/updateServer error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, error instanceof Error ? error.message : 'Failed to update server')
            );
          }
        }

        // Remove server configuration
        if (data.method === 'server-config/removeServer' && data.id) {
          try {
            const { name } = data.params;
            const result = await adapter.removeServerConfig(name);
            sendToApp(createJsonRpcResponse(data.id, result));
          } catch (error) {
            console.error('[McpAppPanel] server-config/removeServer error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, error instanceof Error ? error.message : 'Failed to remove server')
            );
          }
        }

        // Set server enabled state (reuse from tool-manager pattern but for server-config)
        if (data.method === 'server-config/setServerEnabled' && data.id) {
          try {
            const { name, enabled } = data.params;
            const result = await adapter.updateServerConfig(name, { enabled });
            sendToApp(createJsonRpcResponse(data.id, result));
          } catch (error) {
            console.error('[McpAppPanel] server-config/setServerEnabled error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, 'Failed to update server enabled state')
            );
          }
        }

        // Restart server
        if (data.method === 'server-config/restartServer' && data.id) {
          try {
            const { name } = data.params;
            // Note: restartServer is exposed through window.electronAPI but not through the adapter yet
            // For now, we'll use the direct electronAPI if available
            if (window.electronAPI && 'restartServer' in window.electronAPI) {
              await (window.electronAPI as { restartServer: (name: string) => Promise<void> }).restartServer(name);
              sendToApp(createJsonRpcResponse(data.id, { success: true }));
            } else {
              sendToApp(createJsonRpcError(data.id, -32603, 'Restart not available'));
            }
          } catch (error) {
            console.error('[McpAppPanel] server-config/restartServer error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, 'Failed to restart server')
            );
          }
        }

        // Stop server
        if (data.method === 'server-config/stopServer' && data.id) {
          try {
            const { name } = data.params;
            if (window.electronAPI && 'stopServer' in window.electronAPI) {
              await (window.electronAPI as { stopServer: (name: string) => Promise<void> }).stopServer(name);
              sendToApp(createJsonRpcResponse(data.id, { success: true }));
            } else {
              sendToApp(createJsonRpcError(data.id, -32603, 'Stop not available'));
            }
          } catch (error) {
            console.error('[McpAppPanel] server-config/stopServer error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, 'Failed to stop server')
            );
          }
        }

        // Start server
        if (data.method === 'server-config/startServer' && data.id) {
          try {
            const { name } = data.params;
            if (window.electronAPI && 'startServer' in window.electronAPI) {
              await (window.electronAPI as { startServer: (name: string) => Promise<void> }).startServer(name);
              sendToApp(createJsonRpcResponse(data.id, { success: true }));
            } else {
              sendToApp(createJsonRpcError(data.id, -32603, 'Start not available'));
            }
          } catch (error) {
            console.error('[McpAppPanel] server-config/startServer error:', error);
            sendToApp(
              createJsonRpcError(data.id, -32603, 'Failed to start server')
            );
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [panel, sendToApp, buildHostContext, adapter]);

  /**
   * Send app HTML to sandbox proxy when both proxy is ready and UI resource is available
   */
  useEffect(() => {
    if (!proxyReady || !panel.uiResource || !iframeRef.current) return;

    // Get HTML content from UI resource
    const html = panel.uiResource.text || (panel.uiResource as { html?: string }).html;
    if (!html) {
      console.error('[McpAppPanel] UI resource has no HTML content:', panel.uiResource);
      return;
    }

    // Send HTML to sandbox proxy via sandbox-resource-ready message
    // The proxy will inject CSP and host origin, then load into inner iframe
    sendToApp(
      createJsonRpcNotification(MessageTypes.SANDBOX_RESOURCE_READY, {
        html,
        csp: panel.uiResource.csp,
        hostOrigin: window.location.origin,
      })
    );
    console.log('[McpAppPanel] Sent app HTML to sandbox proxy');
  }, [proxyReady, panel.uiResource, sendToApp]);

  /**
   * Send updated tool data when panel.toolInput or panel.toolResult changes
   * (only if app is already initialized)
   */
  useEffect(() => {
    if (appInitialized && panel.toolInput && panel.toolResult !== undefined) {
      sendToApp(
        createJsonRpcNotification(MessageTypes.TOOL_INPUT, {
          arguments: panel.toolInput,
        })
      );
      sendToApp(createJsonRpcNotification(MessageTypes.TOOL_RESULT, panel.toolResult));
    }
  }, [appInitialized, panel.toolInput, panel.toolResult, sendToApp]);

  // Extract tool name for display
  const toolName = panel.uiResourceUri.split('/').pop() || panel.uiResourceUri;

  return (
    <div
      className={`mcp-app-panel ${isActive ? 'active' : ''}`}
      data-key={panel.key}
    >
      {/* Panel Header */}
      <div className="mcp-panel-header">
        <span className="mcp-panel-title">
          {toolName} ({panel.serverName})
        </span>
        <button
          className="mcp-panel-close"
          onClick={onClose}
          title="Close"
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>

      {/* Panel Content */}
      <div
        className="mcp-panel-content"
        style={{ minHeight: minHeight ? `${minHeight}px` : undefined }}
      >
        {panel.loading && (
          <div className="mcp-panel-loading">Loading...</div>
        )}
        {panel.error && (
          <div className="mcp-panel-error">Error: {panel.error}</div>
        )}
        {!panel.loading && !panel.error && sandboxUrl && (
          <iframe
            ref={iframeRef}
            src={sandboxUrl}
            sandbox="allow-scripts allow-same-origin allow-forms"
            title={`MCP App: ${toolName}`}
            className="mcp-app-iframe"
          />
        )}
      </div>
    </div>
  );
}
