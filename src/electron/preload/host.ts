/**
 * Electron Preload Script
 *
 * Exposes a safe, typed API to the renderer process via contextBridge.
 * Only whitelisted IPC channels can be used for security.
 */

import { contextBridge, ipcRenderer } from 'electron';
import * as channels from '../../shared/channels.js';
import type { ChatRequest, StreamEvent } from '../../shared/types.js';

// ============================================
// Channel Whitelist Validation
// ============================================

const allowedInvokeChannels = new Set(channels.INVOKE_CHANNELS);
const allowedOnChannels = new Set(channels.ON_CHANNELS);

function validateInvokeChannel(channel: string): void {
  if (!allowedInvokeChannels.has(channel as channels.InvokeChannel)) {
    throw new Error(`Invalid invoke channel: ${channel}`);
  }
}

function validateOnChannel(channel: string): void {
  if (!allowedOnChannels.has(channel as channels.OnChannel)) {
    throw new Error(`Invalid on channel: ${channel}`);
  }
}

// ============================================
// API Implementation
// ============================================

const electronAPI = {
  // ============================================
  // Server Management
  // ============================================

  getServers: () => {
    validateInvokeChannel(channels.GET_SERVERS);
    return ipcRenderer.invoke(channels.GET_SERVERS);
  },

  getConfig: () => {
    validateInvokeChannel(channels.GET_CONFIG);
    return ipcRenderer.invoke(channels.GET_CONFIG);
  },

  // ============================================
  // Tools
  // ============================================

  getTools: (options?: { hasUi?: boolean }) => {
    validateInvokeChannel(channels.GET_TOOLS);
    return ipcRenderer.invoke(channels.GET_TOOLS, options);
  },

  callTool: (name: string, args: Record<string, unknown>) => {
    validateInvokeChannel(channels.CALL_TOOL);
    return ipcRenderer.invoke(channels.CALL_TOOL, name, args);
  },

  // ============================================
  // Tool Manager
  // ============================================

  getToolManagerTools: (options?: { hasUi?: boolean }) => {
    validateInvokeChannel(channels.GET_TOOL_MANAGER_TOOLS);
    return ipcRenderer.invoke(channels.GET_TOOL_MANAGER_TOOLS, options);
  },

  setToolEnabled: (name: string, enabled: boolean) => {
    validateInvokeChannel(channels.SET_TOOL_ENABLED);
    return ipcRenderer.invoke(channels.SET_TOOL_ENABLED, name, enabled);
  },

  getToolManagerServers: () => {
    validateInvokeChannel(channels.GET_TOOL_MANAGER_SERVERS);
    return ipcRenderer.invoke(channels.GET_TOOL_MANAGER_SERVERS);
  },

  setServerEnabled: (name: string, enabled: boolean) => {
    validateInvokeChannel(channels.SET_SERVER_ENABLED);
    return ipcRenderer.invoke(channels.SET_SERVER_ENABLED, name, enabled);
  },

  // ============================================
  // Resources
  // ============================================

  getResources: () => {
    validateInvokeChannel(channels.GET_RESOURCES);
    return ipcRenderer.invoke(channels.GET_RESOURCES);
  },

  readResource: (serverName: string, uri: string) => {
    validateInvokeChannel(channels.READ_RESOURCE);
    return ipcRenderer.invoke(channels.READ_RESOURCE, serverName, uri);
  },

  getUIResource: (serverName: string, uri: string) => {
    validateInvokeChannel(channels.GET_UI_RESOURCE);
    return ipcRenderer.invoke(channels.GET_UI_RESOURCE, serverName, uri);
  },

  // ============================================
  // Prompts
  // ============================================

  getPrompts: () => {
    validateInvokeChannel(channels.GET_PROMPTS);
    return ipcRenderer.invoke(channels.GET_PROMPTS);
  },

  // ============================================
  // Chat Streaming
  // ============================================

  startChatStream: (request: ChatRequest): Promise<string> => {
    validateInvokeChannel(channels.CHAT_STREAM_START);
    return ipcRenderer.invoke(channels.CHAT_STREAM_START, request);
  },

  cancelChatStream: (streamId: string): Promise<void> => {
    validateInvokeChannel(channels.CHAT_STREAM_CANCEL);
    return ipcRenderer.invoke(channels.CHAT_STREAM_CANCEL, streamId);
  },

  onChatStreamEvent: (
    callback: (event: { streamId: string; event: StreamEvent }) => void
  ): (() => void) => {
    validateOnChannel(channels.CHAT_STREAM_EVENT);
    console.log('[Preload] Registering chat stream event listener for channel:', channels.CHAT_STREAM_EVENT);
    const handler = (_event: Electron.IpcRendererEvent, data: { streamId: string; event: StreamEvent }) => {
      console.log('[Preload] Received chat stream event:', data.streamId, data.event?.type);
      callback(data);
    };
    ipcRenderer.on(channels.CHAT_STREAM_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(channels.CHAT_STREAM_EVENT, handler);
    };
  },

  // ============================================
  // Event Listeners
  // ============================================

  onToolsChanged: (callback: () => void): (() => void) => {
    validateOnChannel(channels.ON_TOOLS_CHANGED);
    const handler = () => callback();
    ipcRenderer.on(channels.ON_TOOLS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(channels.ON_TOOLS_CHANGED, handler);
    };
  },

  onServersChanged: (callback: () => void): (() => void) => {
    validateOnChannel(channels.ON_SERVERS_CHANGED);
    const handler = () => callback();
    ipcRenderer.on(channels.ON_SERVERS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(channels.ON_SERVERS_CHANGED, handler);
    };
  },

  onResourceUpdated: (
    callback: (data: { uri: string; serverName: string }) => void
  ): (() => void) => {
    validateOnChannel(channels.ON_RESOURCE_UPDATED);
    const handler = (_event: Electron.IpcRendererEvent, data: { uri: string; serverName: string }) => {
      callback(data);
    };
    ipcRenderer.on(channels.ON_RESOURCE_UPDATED, handler);
    return () => {
      ipcRenderer.removeListener(channels.ON_RESOURCE_UPDATED, handler);
    };
  },

  onConnectionError: (
    callback: (data: { serverName: string; error: string }) => void
  ): (() => void) => {
    validateOnChannel(channels.ON_CONNECTION_ERROR);
    const handler = (_event: Electron.IpcRendererEvent, data: { serverName: string; error: string }) => {
      callback(data);
    };
    ipcRenderer.on(channels.ON_CONNECTION_ERROR, handler);
    return () => {
      ipcRenderer.removeListener(channels.ON_CONNECTION_ERROR, handler);
    };
  },

  // ============================================
  // Settings
  // ============================================

  getSettings: <T>(): Promise<T> => {
    validateInvokeChannel(channels.GET_SETTINGS);
    return ipcRenderer.invoke(channels.GET_SETTINGS);
  },

  setSettings: <T>(settings: T): Promise<void> => {
    validateInvokeChannel(channels.SET_SETTINGS);
    return ipcRenderer.invoke(channels.SET_SETTINGS, settings);
  },

  // ============================================
  // Window Controls
  // ============================================

  minimizeWindow: () => {
    validateInvokeChannel(channels.WINDOW_MINIMIZE);
    ipcRenderer.invoke(channels.WINDOW_MINIMIZE);
  },

  maximizeWindow: () => {
    validateInvokeChannel(channels.WINDOW_MAXIMIZE);
    ipcRenderer.invoke(channels.WINDOW_MAXIMIZE);
  },

  closeWindow: () => {
    validateInvokeChannel(channels.WINDOW_CLOSE);
    ipcRenderer.invoke(channels.WINDOW_CLOSE);
  },
};

// ============================================
// Chat Stream Event Handling
// Register listener at module load (before contextBridge)
// ============================================

type ChatStreamCallback = (data: { streamId: string; event: StreamEvent }) => void;
const chatStreamCallbacks: ChatStreamCallback[] = [];

// Register listener once at module load - this works!
ipcRenderer.on(channels.CHAT_STREAM_EVENT, (_event, data: { streamId: string; event: StreamEvent }) => {
  console.log('[Preload] Chat stream event received:', data.streamId, data.event?.type);
  // Forward to all registered callbacks
  for (const callback of chatStreamCallbacks) {
    try {
      callback(data);
    } catch (err) {
      console.error('[Preload] Callback error:', err);
    }
  }
});

// ============================================
// Expose API to Renderer
// ============================================

contextBridge.exposeInMainWorld('electronAPI', {
  ...electronAPI,
  // Override onChatStreamEvent to use the pre-registered listener
  onChatStreamEvent: (callback: ChatStreamCallback): (() => void) => {
    console.log('[Preload] Adding chat stream callback');
    chatStreamCallbacks.push(callback);
    return () => {
      const idx = chatStreamCallbacks.indexOf(callback);
      if (idx >= 0) {
        chatStreamCallbacks.splice(idx, 1);
        console.log('[Preload] Removed chat stream callback');
      }
    };
  },
});

// Export type for TypeScript
export type ElectronAPI = typeof electronAPI;
