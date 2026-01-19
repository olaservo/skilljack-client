/**
 * IPC Communication Adapter
 *
 * Implements CommunicationAdapter using Electron IPC for desktop mode.
 * Communicates with main process via contextBridge-exposed API.
 */

import type {
  CommunicationAdapter,
  ElectronAPI,
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

// Module-level singleton state for chat stream listener
let chatStreamListenerRegistered = false;

// Default no-op resolve function used to detect when no one is waiting
const defaultResolve = (_value: IteratorResult<StreamEvent>) => {};

let globalActiveStreams: Map<string, {
  resolve: (value: IteratorResult<StreamEvent>) => void;
  defaultResolve: (value: IteratorResult<StreamEvent>) => void;
  events: StreamEvent[];
  done: boolean;
}> | null = null;

export function createIPCAdapter(electronAPI: ElectronAPI): CommunicationAdapter {
  // Track event listener cleanup functions
  const cleanupFns: Array<() => void> = [];

  // Track active chat streams
  const activeStreams = new Map<string, {
    resolve: (value: IteratorResult<StreamEvent>) => void;
    defaultResolve: (value: IteratorResult<StreamEvent>) => void;
    events: StreamEvent[];
    done: boolean;
  }>();

  // Set up chat stream event listener once (singleton pattern)
  // Only register if not already registered to handle React StrictMode double-mount
  if (!chatStreamListenerRegistered) {
    console.log('[IPC Adapter] Setting up chat stream event listener');
    chatStreamListenerRegistered = true;
    globalActiveStreams = activeStreams;

    electronAPI.onChatStreamEvent(({ streamId, event }) => {
      console.log('[IPC Adapter] Received stream event:', streamId, event.type);
      const stream = globalActiveStreams?.get(streamId);
      if (!stream) {
        console.warn('[IPC Adapter] No active stream found for:', streamId);
        return;
      }

      if (event.type === 'done' || event.type === 'error') {
        stream.done = true;
      }

      // If someone is waiting (resolve is set), resolve immediately
      // Otherwise buffer the event for later consumption
      if (stream.resolve !== stream.defaultResolve) {
        const resolveRef = stream.resolve;
        stream.resolve = stream.defaultResolve;
        resolveRef({ value: event, done: false });
      } else {
        stream.events.push(event);
      }
    });
  } else {
    console.log('[IPC Adapter] Chat stream listener already registered, updating streams reference');
    globalActiveStreams = activeStreams;
  }

  return {
    // ============================================
    // Server Management
    // ============================================

    async getServers(): Promise<ServerSummary[]> {
      const data = await electronAPI.getServers();
      return data.servers || [];
    },

    async getConfig(): Promise<WebConfig> {
      return electronAPI.getConfig();
    },

    // ============================================
    // Tools
    // ============================================

    async getTools(opts?: { hasUi?: boolean }): Promise<ToolWithUIInfo[]> {
      const data = await electronAPI.getTools(opts);
      return data.tools || [];
    },

    async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
      return electronAPI.callTool(name, args);
    },

    // ============================================
    // Tool Manager
    // ============================================

    async getToolManagerTools(opts?: { hasUi?: boolean }): Promise<ToolWithEnabledState[]> {
      const data = await electronAPI.getToolManagerTools(opts);
      return data.tools || [];
    },

    async setToolEnabled(
      name: string,
      enabled: boolean
    ): Promise<{ name: string; enabled: boolean }> {
      return electronAPI.setToolEnabled(name, enabled);
    },

    async getToolManagerServers(): Promise<ServerWithState[]> {
      const data = await electronAPI.getToolManagerServers();
      return data.servers || [];
    },

    async setServerEnabled(
      name: string,
      enabled: boolean
    ): Promise<{ name: string; enabled: boolean }> {
      return electronAPI.setServerEnabled(name, enabled);
    },

    // ============================================
    // Resources
    // ============================================

    async getResources(): Promise<ResourceInfo[]> {
      const data = await electronAPI.getResources();
      return data.resources || [];
    },

    async readResource(serverName: string, uri: string): Promise<unknown> {
      return electronAPI.readResource(serverName, uri);
    },

    async getUIResource(serverName: string, uri: string): Promise<UIResource | null> {
      return electronAPI.getUIResource(serverName, uri);
    },

    // ============================================
    // Prompts
    // ============================================

    async getPrompts(): Promise<PromptInfo[]> {
      const data = await electronAPI.getPrompts();
      return data.prompts || [];
    },

    // ============================================
    // Chat (Streaming)
    // ============================================

    async *streamChat(request: ChatRequest): AsyncIterable<StreamEvent> {
      // Start the stream and get a unique ID
      const streamId = await electronAPI.startChatStream(request);

      // Create stream state
      const streamState = {
        resolve: defaultResolve,
        defaultResolve: defaultResolve,
        events: [] as StreamEvent[],
        done: false,
      };
      activeStreams.set(streamId, streamState);

      try {
        while (true) {
          // Check if we have buffered events first
          if (streamState.events.length > 0) {
            const event = streamState.events.shift()!;
            yield event;
            if (event.type === 'done' || event.type === 'error') {
              break;
            }
            continue;
          }

          // If stream is done and no buffered events, we're finished
          if (streamState.done) {
            break;
          }

          // Wait for next event
          const event = await new Promise<StreamEvent>((resolve) => {
            streamState.resolve = (result) => {
              streamState.resolve = defaultResolve;
              resolve(result.value);
            };
          });

          yield event;

          if (event.type === 'done' || event.type === 'error') {
            break;
          }
        }
      } finally {
        activeStreams.delete(streamId);
      }
    },

    // ============================================
    // Events
    // ============================================

    onEvent(handler: (event: WebSocketEvent) => void): () => void {
      const cleanups: Array<() => void> = [];

      cleanups.push(
        electronAPI.onToolsChanged(() => {
          handler({ type: 'tools_changed' });
        })
      );

      cleanups.push(
        electronAPI.onServersChanged(() => {
          handler({ type: 'servers_changed' });
        })
      );

      cleanups.push(
        electronAPI.onResourceUpdated((data) => {
          handler({ type: 'resource_updated', ...data });
        })
      );

      cleanups.push(
        electronAPI.onConnectionError((data) => {
          handler({ type: 'connection_error', ...data });
        })
      );

      return () => {
        cleanups.forEach((cleanup) => cleanup());
      };
    },

    // ============================================
    // Cleanup
    // ============================================

    dispose(): void {
      cleanupFns.forEach((cleanup) => cleanup());
      cleanupFns.length = 0;
      activeStreams.clear();
    },
  };
}
