/**
 * API Route Handlers
 *
 * REST API for browser to interact with MCP server(s).
 * Supports both single-client and multi-server modes.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getToolUiResourceUri, fetchUIResource } from '../capabilities/apps.js';
import {
  aggregateTools,
  aggregatePrompts,
  aggregateResources,
  callToolAcrossServers,
  getServersSummary,
  type AggregatedTool,
} from '../multi-server.js';
import {
  isToolEnabled,
  setToolEnabled,
  addEnabledState,
  filterEnabledTools,
  isServerEnabled,
  setServerEnabled,
  getServersWithState,
} from './tool-manager-state.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) => Promise<void>;

function sendJSON(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, message: string, status = 500): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

/** Tool info with UI detection for display */
interface ToolWithUIInfo {
  /** Qualified name for API calls (server__tool) */
  name: string;
  /** Original tool name for display */
  displayName: string;
  description?: string;
  hasUi: boolean;
  uiResourceUri?: string;
  serverName: string;
}

/** Built-in tool-manager pseudo-tool */
const TOOL_MANAGER_TOOL: ToolWithUIInfo = {
  name: 'tool-manager__manage-tools',
  displayName: 'manage-tools',
  description: 'View and enable/disable tools from connected MCP servers',
  hasUi: true,
  uiResourceUri: 'builtin://tool-manager',
  serverName: 'tool-manager',
};

/** Convert aggregated tools to UI info format */
function toolsToUIInfo(tools: AggregatedTool[]): ToolWithUIInfo[] {
  return tools.map((tool) => {
    const uiResourceUri = getToolUiResourceUri(tool);
    return {
      name: tool.name,
      displayName: tool.originalName,
      description: tool.description,
      hasUi: !!uiResourceUri,
      uiResourceUri,
      serverName: tool.serverName,
    };
  });
}

/**
 * Create route handler for single-client mode (backward compatible)
 */
export function createRouteHandler(client: Client, sandboxPort: number): RouteHandler {
  // Wrap single client in a Map for unified handling
  const clients = new Map<string, Client>([['default', client]]);
  return createMultiServerRouteHandler(clients, sandboxPort);
}

/**
 * Create route handler for multi-server mode
 */
export function createMultiServerRouteHandler(
  clients: Map<string, Client>,
  sandboxPort: number
): RouteHandler {
  return async (req, res, url) => {
    const method = req.method || 'GET';
    const path = url.pathname;

    try {
      // GET /api/servers - List connected servers
      if (method === 'GET' && path === '/api/servers') {
        const summary = await getServersSummary(clients);
        sendJSON(res, { servers: summary });
        return;
      }

      // GET /api/server - Server info (single server mode compat)
      if (method === 'GET' && path === '/api/server') {
        // Return first server for backward compatibility
        const firstClient = clients.values().next().value;
        if (firstClient) {
          const serverVersion = firstClient.getServerVersion();
          const capabilities = firstClient.getServerCapabilities();
          sendJSON(res, { serverVersion, capabilities });
        } else {
          sendError(res, 'No servers connected', 404);
        }
        return;
      }

      // GET /api/config - Web UI config (sandbox port, etc.)
      if (method === 'GET' && path === '/api/config') {
        sendJSON(res, {
          sandboxPort,
          multiServer: clients.size > 1,
          serverCount: clients.size,
        });
        return;
      }

      // GET /api/tools - List tools from all servers with UI info
      // Injects built-in tool-manager and filters disabled tools
      // Optional: ?hasUi=true to filter for UI tools only
      if (method === 'GET' && path === '/api/tools') {
        const hasUiParam = url.searchParams.get('hasUi');
        const tools = await aggregateTools(clients);
        let toolsWithUI = toolsToUIInfo(tools);

        // Filter by hasUi if requested
        if (hasUiParam === 'true') {
          toolsWithUI = toolsWithUI.filter((t) => t.hasUi);
        }

        // Add tool-manager pseudo-tool at the beginning, filter disabled tools
        const allTools = [TOOL_MANAGER_TOOL, ...filterEnabledTools(toolsWithUI)];
        sendJSON(res, { tools: allTools });
        return;
      }

      // GET /api/tool-manager/tools - List ALL tools with enabled state (for tool manager UI)
      // Optional: ?hasUi=true to filter for UI tools only
      if (method === 'GET' && path === '/api/tool-manager/tools') {
        const hasUiParam = url.searchParams.get('hasUi');
        const tools = await aggregateTools(clients);
        let toolsWithUI = toolsToUIInfo(tools);

        // Filter by hasUi if requested
        if (hasUiParam === 'true') {
          toolsWithUI = toolsWithUI.filter((t) => t.hasUi);
        }

        const toolsWithState = addEnabledState(toolsWithUI);
        sendJSON(res, { tools: toolsWithState });
        return;
      }

      // PUT /api/tool-manager/tools/:name - Set tool enabled state
      if (method === 'PUT' && path.startsWith('/api/tool-manager/tools/')) {
        const toolName = decodeURIComponent(path.slice('/api/tool-manager/tools/'.length));
        const body = await readBody(req);
        const { enabled } = body ? JSON.parse(body) : { enabled: true };

        setToolEnabled(toolName, enabled);
        sendJSON(res, { name: toolName, enabled: isToolEnabled(toolName) });
        return;
      }

      // GET /api/tool-manager/servers - List servers with enabled state
      if (method === 'GET' && path === '/api/tool-manager/servers') {
        const tools = await aggregateTools(clients);
        const toolsWithUI = toolsToUIInfo(tools);
        const servers = getServersWithState(toolsWithUI);
        sendJSON(res, { servers });
        return;
      }

      // PUT /api/tool-manager/servers/:name - Set server enabled state
      if (method === 'PUT' && path.startsWith('/api/tool-manager/servers/')) {
        const serverName = decodeURIComponent(path.slice('/api/tool-manager/servers/'.length));
        const body = await readBody(req);
        const { enabled } = body ? JSON.parse(body) : { enabled: true };

        setServerEnabled(serverName, enabled);
        sendJSON(res, { name: serverName, enabled: isServerEnabled(serverName) });
        return;
      }

      // POST /api/tools/:name - Call a tool (routes to correct server)
      if (method === 'POST' && path.startsWith('/api/tools/')) {
        const toolName = decodeURIComponent(path.slice('/api/tools/'.length));
        const body = await readBody(req);
        const args = body ? JSON.parse(body) : {};

        // Handle built-in tool-manager pseudo-tool (no actual execution needed)
        if (toolName === 'tool-manager__manage-tools') {
          sendJSON(res, {
            content: [{ type: 'text', text: 'Tool manager opened.' }],
            serverName: 'tool-manager',
          });
          return;
        }

        // Use longer timeout (120s) for potentially slow system operations
        const { serverName, result } = await callToolAcrossServers(clients, toolName, args, {
          timeout: 120000,
        });
        sendJSON(res, { ...result, serverName });
        return;
      }

      // GET /api/resources - List resources from all servers
      if (method === 'GET' && path === '/api/resources') {
        const resources = await aggregateResources(clients);
        sendJSON(res, { resources });
        return;
      }

      // GET /api/resources/:uri - Read a resource
      // Format: /api/resources/<serverName>/<uri>
      if (method === 'GET' && path.startsWith('/api/resources/')) {
        const rest = path.slice('/api/resources/'.length);
        const slashIndex = rest.indexOf('/');

        let serverName: string;
        let uri: string;

        if (slashIndex > 0) {
          // Multi-server format: /api/resources/serverName/uri
          serverName = decodeURIComponent(rest.slice(0, slashIndex));
          uri = decodeURIComponent(rest.slice(slashIndex + 1));
        } else {
          // Single-server format: /api/resources/uri (use first server)
          serverName = clients.keys().next().value || 'default';
          uri = decodeURIComponent(rest);
        }

        const client = clients.get(serverName);
        if (!client) {
          sendError(res, `Server not found: ${serverName}`, 404);
          return;
        }

        const result = await client.readResource({ uri });
        sendJSON(res, { ...result, serverName });
        return;
      }

      // GET /api/ui-resource/:serverName/:uri - Fetch UI resource HTML
      if (method === 'GET' && path.startsWith('/api/ui-resource/')) {
        const rest = path.slice('/api/ui-resource/'.length);
        const slashIndex = rest.indexOf('/');

        let serverName: string;
        let uri: string;

        if (slashIndex > 0) {
          serverName = decodeURIComponent(rest.slice(0, slashIndex));
          uri = decodeURIComponent(rest.slice(slashIndex + 1));
        } else {
          serverName = clients.keys().next().value || 'default';
          uri = decodeURIComponent(rest);
        }

        // Handle built-in tool-manager UI resource
        if (serverName === 'tool-manager' && uri === 'builtin://tool-manager') {
          try {
            // Look for the HTML in static/tool-manager/mcp-app.html
            const staticDir = __dirname.includes('dist')
              ? join(__dirname, '..', '..', 'src', 'web', 'static')
              : join(__dirname, 'static');
            const htmlPath = join(staticDir, 'tool-manager', 'mcp-app.html');
            const html = await readFile(htmlPath, 'utf-8');
            sendJSON(res, {
              uri,
              mimeType: 'text/html;mcp-app',
              text: html,
              serverName: 'tool-manager',
            });
          } catch (err) {
            sendError(res, 'Tool manager UI not found', 404);
          }
          return;
        }

        const client = clients.get(serverName);
        if (!client) {
          sendError(res, `Server not found: ${serverName}`, 404);
          return;
        }

        const resource = await fetchUIResource(client, uri);
        if (resource) {
          sendJSON(res, { ...resource, serverName });
        } else {
          sendError(res, 'UI resource not found or invalid', 404);
        }
        return;
      }

      // GET /api/prompts - List prompts from all servers
      if (method === 'GET' && path === '/api/prompts') {
        const prompts = await aggregatePrompts(clients);
        sendJSON(res, { prompts });
        return;
      }

      sendError(res, 'Not Found', 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendError(res, message);
    }
  };
}
