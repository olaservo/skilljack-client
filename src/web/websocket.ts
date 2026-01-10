/**
 * WebSocket Handler
 *
 * Real-time updates for list changes and tool results.
 * Supports both single-client and multi-server modes.
 */

import type { WebSocketServer, WebSocket } from 'ws';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { setupListChanged } from '../capabilities/list-changed.js';
import { setupListChangedForAll } from '../multi-server.js';

export interface WebSocketEvent {
  type: string;
  data: unknown;
}

export interface WebSocketManager {
  broadcast: (event: WebSocketEvent) => void;
  getConnectionCount: () => number;
}

/**
 * Create WebSocket handler for single-client mode (backward compatible)
 */
export function createWebSocketHandler(
  wss: WebSocketServer,
  client: Client
): WebSocketManager {
  const clients = new Map<string, Client>([['default', client]]);
  return createMultiServerWebSocketHandler(wss, clients);
}

/**
 * Create WebSocket handler for multi-server mode
 */
export function createMultiServerWebSocketHandler(
  wss: WebSocketServer,
  mcpClients: Map<string, Client>
): WebSocketManager {
  const wsClients = new Set<WebSocket>();

  // Track connections
  wss.on('connection', (ws) => {
    wsClients.add(ws);

    ws.on('close', () => {
      wsClients.delete(ws);
    });

    ws.on('error', () => {
      wsClients.delete(ws);
    });

    // Send initial connection confirmation with server list
    ws.send(JSON.stringify({
      type: 'connected',
      data: {
        timestamp: Date.now(),
        servers: Array.from(mcpClients.keys()),
      },
    }));
  });

  const broadcast = (event: WebSocketEvent) => {
    const message = JSON.stringify(event);
    for (const ws of wsClients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    }
  };

  // Set up list change notifications for all servers
  setupListChangedForAll(mcpClients, {
    onToolsChanged: (serverName, tools) => {
      broadcast({
        type: 'tools_changed',
        data: { serverName, tools },
      });
    },
    onPromptsChanged: (serverName, prompts) => {
      broadcast({
        type: 'prompts_changed',
        data: { serverName, prompts },
      });
    },
    onResourcesChanged: (serverName, resources) => {
      broadcast({
        type: 'resources_changed',
        data: { serverName, resources },
      });
    },
  });

  return {
    broadcast,
    getConnectionCount: () => wsClients.size,
  };
}
