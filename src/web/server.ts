/**
 * Web Server for MCP Apps UI
 *
 * Starts an HTTP server that serves a browser UI for interacting with
 * MCP servers and rendering MCP App iframes.
 *
 * Supports both single-client and multi-server modes.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createRouteHandler, createMultiServerRouteHandler } from './routes.js';
import { createWebSocketHandler, createMultiServerWebSocketHandler, type WebSocketManager } from './websocket.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Static files are in src/web/static, not dist/web/static
// Resolve the path correctly whether running from src or dist
function getStaticDir(): string {
  const currentDir = __dirname;
  // If running from dist/web/, look in src/web/static
  if (currentDir.includes('dist')) {
    return join(currentDir, '..', '..', 'src', 'web', 'static');
  }
  // If running from src/web/, look in src/web/static
  return join(currentDir, 'static');
}

export interface WebServerConfig {
  port: number;
  sandboxPort: number;
  client: Client;
  onLog?: (message: string) => void;
}

export interface MultiServerWebConfig {
  port: number;
  sandboxPort: number;
  clients: Map<string, Client>;
  onLog?: (message: string) => void;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function serveStaticFile(
  filePath: string,
  res: ServerResponse
): Promise<boolean> {
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start web server in single-client mode (backward compatible)
 */
export async function startWebServer(config: WebServerConfig): Promise<{
  close: () => void;
  wsManager: WebSocketManager;
}> {
  const { port, sandboxPort, client, onLog } = config;
  const clients = new Map<string, Client>([['default', client]]);

  return startMultiServerWebServer({
    port,
    sandboxPort,
    clients,
    onLog,
  });
}

/**
 * Start web server in multi-server mode
 */
export async function startMultiServerWebServer(config: MultiServerWebConfig): Promise<{
  close: () => void;
  wsManager: WebSocketManager;
}> {
  const { port, sandboxPort, clients, onLog } = config;
  const log = onLog || console.log;

  const staticDir = getStaticDir();
  const routeHandler = createMultiServerRouteHandler(clients, sandboxPort);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      await routeHandler(req, res, url);
      return;
    }

    // Static files
    let filePath = join(staticDir, url.pathname === '/' ? 'index.html' : url.pathname);

    const served = await serveStaticFile(filePath, res);
    if (!served) {
      // Try index.html for SPA-style routing
      filePath = join(staticDir, 'index.html');
      const fallbackServed = await serveStaticFile(filePath, res);
      if (!fallbackServed) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    }
  });

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ server });
  const wsManager = createMultiServerWebSocketHandler(wss, clients);

  return new Promise((resolve) => {
    server.listen(port, () => {
      log(`[Web] Server running at http://localhost:${port}`);
      log(`[Web] Sandbox proxy expected at http://localhost:${sandboxPort}`);
      log(`[Web] Connected to ${clients.size} server(s): ${Array.from(clients.keys()).join(', ')}`);
      resolve({
        close: () => {
          wss.close();
          server.close();
        },
        wsManager,
      });
    });
  });
}
