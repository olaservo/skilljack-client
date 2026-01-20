/**
 * HTTP Communication Adapter
 *
 * Implements CommunicationAdapter using HTTP/fetch for web mode.
 * Connects to the web server's REST API endpoints.
 */

import type {
  CommunicationAdapter,
  AdapterOptions,
} from './types.js';
import type {
  ServerSummary,
  ToolWithUIInfo,
  ToolWithEnabledState,
  ToolCallResult,
  ResourceInfo,
  UIResource,
  PromptInfo,
  ChatRequest,
  StreamEvent,
  WebSocketEvent,
  WebConfig,
  ServerWithState,
} from '../shared/types.js';

export function createHTTPAdapter(options: AdapterOptions = {}): CommunicationAdapter {
  const baseUrl = options.baseUrl || '';
  const timeout = options.timeout || 120000;

  // WebSocket connection for real-time events
  let ws: WebSocket | null = null;
  const eventHandlers = new Set<(event: WebSocketEvent) => void>();

  function connectWebSocket(): void {
    if (ws?.readyState === WebSocket.OPEN) return;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WebSocketEvent;
          eventHandlers.forEach((handler) => handler(data));
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        // Reconnect after a delay
        setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    } catch {
      // WebSocket not available
    }
  }

  async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    // ============================================
    // Server Management
    // ============================================

    async getServers(): Promise<ServerSummary[]> {
      const data = await fetchJSON<{ servers: ServerSummary[] }>('/api/servers');
      return data.servers || [];
    },

    async getConfig(): Promise<WebConfig> {
      return fetchJSON<WebConfig>('/api/config');
    },

    // ============================================
    // Tools
    // ============================================

    async getTools(opts?: { hasUi?: boolean }): Promise<ToolWithUIInfo[]> {
      const query = opts?.hasUi ? '?hasUi=true' : '';
      const data = await fetchJSON<{ tools: ToolWithUIInfo[] }>(`/api/tools${query}`);
      return data.tools || [];
    },

    async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
      return fetchJSON<ToolCallResult>(`/api/tools/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    },

    // ============================================
    // Tool Manager
    // ============================================

    async getToolManagerTools(opts?: { hasUi?: boolean }): Promise<ToolWithEnabledState[]> {
      const query = opts?.hasUi ? '?hasUi=true' : '';
      const data = await fetchJSON<{ tools: ToolWithEnabledState[] }>(
        `/api/tool-manager/tools${query}`
      );
      return data.tools || [];
    },

    async setToolEnabled(
      name: string,
      enabled: boolean
    ): Promise<{ name: string; enabled: boolean }> {
      return fetchJSON<{ name: string; enabled: boolean }>(
        `/api/tool-manager/tools/${encodeURIComponent(name)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        }
      );
    },

    async getToolManagerServers(): Promise<ServerWithState[]> {
      const data = await fetchJSON<{ servers: ServerWithState[] }>('/api/tool-manager/servers');
      return data.servers || [];
    },

    async setServerEnabled(
      name: string,
      enabled: boolean
    ): Promise<{ name: string; enabled: boolean }> {
      return fetchJSON<{ name: string; enabled: boolean }>(
        `/api/tool-manager/servers/${encodeURIComponent(name)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        }
      );
    },

    // ============================================
    // Resources
    // ============================================

    async getResources(): Promise<ResourceInfo[]> {
      const data = await fetchJSON<{ resources: ResourceInfo[] }>('/api/resources');
      return data.resources || [];
    },

    async readResource(serverName: string, uri: string): Promise<unknown> {
      return fetchJSON<unknown>(
        `/api/resources/${encodeURIComponent(serverName)}/${encodeURIComponent(uri)}`
      );
    },

    async getUIResource(serverName: string, uri: string): Promise<UIResource | null> {
      try {
        return await fetchJSON<UIResource>(
          `/api/ui-resource/${encodeURIComponent(serverName)}/${encodeURIComponent(uri)}`
        );
      } catch {
        return null;
      }
    },

    // ============================================
    // Prompts
    // ============================================

    async getPrompts(): Promise<PromptInfo[]> {
      const data = await fetchJSON<{ prompts: PromptInfo[] }>('/api/prompts');
      return data.prompts || [];
    },

    // ============================================
    // Chat (Streaming)
    // ============================================

    async *streamChat(request: ChatRequest): AsyncIterable<StreamEvent> {
      const controller = new AbortController();

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const event = JSON.parse(data) as StreamEvent;
                yield event;
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },

    // ============================================
    // Events
    // ============================================

    onEvent(handler: (event: WebSocketEvent) => void): () => void {
      eventHandlers.add(handler);

      // Connect WebSocket on first listener
      if (eventHandlers.size === 1) {
        connectWebSocket();
      }

      return () => {
        eventHandlers.delete(handler);

        // Disconnect if no more listeners
        if (eventHandlers.size === 0 && ws) {
          ws.close();
          ws = null;
        }
      };
    },

    // ============================================
    // Cleanup
    // ============================================

    dispose(): void {
      eventHandlers.clear();
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}
