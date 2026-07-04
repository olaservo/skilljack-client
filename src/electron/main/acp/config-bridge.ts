/**
 * ACP Config Bridge
 *
 * Hosts Skilljack's server-config tools as an HTTP MCP server on
 * 127.0.0.1 so ACP agents can manage the app's MCP servers. Backed by
 * the live McpManager (same handlers the built-in chat tools use), so
 * changes apply immediately: lifecycle ops actually start/stop servers
 * and the renderer sees updates through the normal event bridge.
 *
 * Security: bound to loopback only, and every request must carry a
 * bearer token that is generated per app run and passed to agents via
 * the ACP mcpServers headers.
 */

import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import log from 'electron-log';
import {
  SERVER_CONFIG_ACTION_TOOLS,
  CONFIGURE_SERVERS_TOOL,
  SERVER_CONFIG_UI_URI,
  INSTALL_MCPB_NAME,
  ListServersSchema,
  AddServerSchema,
  RemoveServerSchema,
  RestartServerSchema,
  StopServerSchema,
  StartServerSchema,
  EnableServerSchema,
  DisableServerSchema,
} from '@skilljack/internal-server-config';
import type { McpManager } from '../mcp-manager.js';
import type { AcpOpenAppPayload } from '../../../shared/acp-types.js';

export interface ConfigBridge {
  url: string;
  authToken: string;
  close(): Promise<void>;
}

export interface ConfigBridgeOptions {
  getMcpManager: () => McpManager | null;
  /** Ask the renderer to open an MCP App panel; returns false if no window */
  openApp: (payload: AcpOpenAppPayload) => boolean;
}

// registerTool expects a Zod RAW SHAPE ({ name: z.string() }), not the
// z.object(...) wrapper — passing the object advertises an empty input
// schema in tools/list, so models guess wrong argument names.
type ZodObjectLike = { shape: Record<string, unknown> };

const TOOL_SCHEMAS: Record<string, Record<string, unknown>> = {
  'server-config__list-servers': (ListServersSchema as ZodObjectLike).shape,
  'server-config__add-server': (AddServerSchema as ZodObjectLike).shape,
  'server-config__remove-server': (RemoveServerSchema as ZodObjectLike).shape,
  'server-config__restart-server': (RestartServerSchema as ZodObjectLike).shape,
  'server-config__stop-server': (StopServerSchema as ZodObjectLike).shape,
  'server-config__start-server': (StartServerSchema as ZodObjectLike).shape,
  'server-config__enable-server': (EnableServerSchema as ZodObjectLike).shape,
  'server-config__disable-server': (DisableServerSchema as ZodObjectLike).shape,
};

/**
 * Strip Skilljack-internal fields (audience/priority annotations) from
 * tool result content. They are valid MCP, but strict agent-side MCP
 * clients (e.g. Codex's Rust client) reject results carrying them with
 * "Unexpected response type", and they only matter to Skilljack's own UI.
 */
function sanitizeContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((item) => {
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      if (record.type === 'text') {
        return { type: 'text', text: record.text };
      }
      if ('annotations' in record) {
        const { annotations: _dropped, ...rest } = record;
        return rest;
      }
    }
    return item;
  });
}

function buildBridgeServer(options: ConfigBridgeOptions): McpServer {
  const { getMcpManager, openApp } = options;
  const server = new McpServer(
    {
      name: 'skilljack',
      title: 'Skilljack Server Configuration',
      version: '0.2.0',
    },
    {
      capabilities: { tools: {} },
      instructions:
        'Tools for managing the MCP servers configured in the Skilljack Client app ' +
        '(the app that launched this agent session). Changes apply to the running app immediately.',
    }
  );

  // configure-servers opens the visual config panel in the Skilljack window
  (server.registerTool as Function)(
    CONFIGURE_SERVERS_TOOL.displayName,
    {
      title: CONFIGURE_SERVERS_TOOL.title,
      description:
        'SHOW or DISPLAY the Skilljack server configuration UI. Use when the user wants to ' +
        'SEE, VIEW, or SHOW their MCP server connections — opens a visual panel in the Skilljack window.',
      inputSchema: {},
      annotations: CONFIGURE_SERVERS_TOOL.annotations,
    },
    async () => {
      const opened = openApp({
        serverName: 'server-config',
        uiResourceUri: SERVER_CONFIG_UI_URI,
      });
      return {
        content: [
          {
            type: 'text',
            text: opened
              ? 'Opened the server configuration UI in the Skilljack window.'
              : 'Could not open the UI: the Skilljack window is not available.',
          },
        ],
        isError: !opened,
      };
    }
  );

  for (const tool of SERVER_CONFIG_ACTION_TOOLS) {
    // install-mcpb needs the app's confirmation dialog flow, which is
    // renderer-driven — it dead-ends when invoked by an external agent.
    if (tool.name === INSTALL_MCPB_NAME) continue;
    const inputSchema = TOOL_SCHEMAS[tool.name];
    if (!inputSchema) continue;

    // Same type-recursion workaround as the package's standalone server.ts
    (server.registerTool as Function)(
      tool.displayName,
      {
        title: tool.title,
        description: tool.description,
        inputSchema,
        annotations: tool.annotations,
      },
      async (args: unknown) => {
        const mcpManager = getMcpManager();
        if (!mcpManager) {
          return {
            content: [{ type: 'text', text: 'Skilljack server manager is not available' }],
            isError: true,
          };
        }
        try {
          const result = await mcpManager.callTool(
            tool.name,
            (args ?? {}) as Record<string, unknown>
          );
          return { content: sanitizeContent(result.content), isError: result.isError };
        } catch (err) {
          return {
            content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export async function startConfigBridge(options: ConfigBridgeOptions): Promise<ConfigBridge> {
  const authToken = randomBytes(24).toString('hex');

  const httpServer: HttpServer = createHttpServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${authToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404).end();
        return;
      }
      if (req.method !== 'POST') {
        // Stateless mode: no SSE stream (GET) or session teardown (DELETE)
        res.writeHead(405, { Allow: 'POST' }).end();
        return;
      }

      const body = await readBody(req);
      // Stateless: fresh server + transport per request
      const server = buildBridgeServer(options);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      log.error('[ACP] Config bridge request failed:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'internal error' }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (httpServer.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/mcp`;
  log.info(`[ACP] Config bridge listening at ${url}`);

  return {
    url,
    authToken,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections?.();
      }),
  };
}
