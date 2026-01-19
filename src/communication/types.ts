/**
 * Communication Adapter Types
 *
 * Unified interface for renderer-to-backend communication.
 * Implemented by HTTP adapter (web mode) and IPC adapter (Electron mode).
 */

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

// ============================================
// Core Adapter Interface
// ============================================

export interface CommunicationAdapter {
  // Server Management
  getServers(): Promise<ServerSummary[]>;
  getConfig(): Promise<WebConfig>;

  // Tools
  getTools(options?: { hasUi?: boolean }): Promise<ToolWithUIInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;

  // Tool Manager
  getToolManagerTools(options?: { hasUi?: boolean }): Promise<ToolWithEnabledState[]>;
  setToolEnabled(name: string, enabled: boolean): Promise<{ name: string; enabled: boolean }>;
  getToolManagerServers(): Promise<ServerWithState[]>;
  setServerEnabled(name: string, enabled: boolean): Promise<{ name: string; enabled: boolean }>;

  // Resources
  getResources(): Promise<ResourceInfo[]>;
  readResource(serverName: string, uri: string): Promise<unknown>;
  getUIResource(serverName: string, uri: string): Promise<UIResource | null>;

  // Prompts
  getPrompts(): Promise<PromptInfo[]>;

  // Chat (streaming)
  streamChat(request: ChatRequest): AsyncIterable<StreamEvent>;

  // Events (for real-time updates)
  onEvent(handler: (event: WebSocketEvent) => void): () => void;

  // Cleanup
  dispose(): void;
}

// ============================================
// Adapter Factory Types
// ============================================

export interface AdapterOptions {
  /** Base URL for HTTP adapter */
  baseUrl?: string;
  /** Timeout for requests in ms */
  timeout?: number;
}

export type AdapterFactory = (options?: AdapterOptions) => CommunicationAdapter;

// ============================================
// Electron API Types (exposed via contextBridge)
// ============================================

export interface ElectronAPI {
  // Server Management
  getServers(): Promise<{ servers: ServerSummary[] }>;
  getConfig(): Promise<WebConfig>;

  // Tools
  getTools(options?: { hasUi?: boolean }): Promise<{ tools: ToolWithUIInfo[] }>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;

  // Tool Manager
  getToolManagerTools(options?: { hasUi?: boolean }): Promise<{ tools: ToolWithEnabledState[] }>;
  setToolEnabled(name: string, enabled: boolean): Promise<{ name: string; enabled: boolean }>;
  getToolManagerServers(): Promise<{ servers: ServerWithState[] }>;
  setServerEnabled(name: string, enabled: boolean): Promise<{ name: string; enabled: boolean }>;

  // Resources
  getResources(): Promise<{ resources: ResourceInfo[] }>;
  readResource(serverName: string, uri: string): Promise<unknown>;
  getUIResource(serverName: string, uri: string): Promise<UIResource | null>;

  // Prompts
  getPrompts(): Promise<{ prompts: PromptInfo[] }>;

  // Chat (streaming)
  startChatStream(request: ChatRequest): Promise<string>; // Returns stream ID
  cancelChatStream(streamId: string): Promise<void>;
  onChatStreamEvent(
    callback: (event: { streamId: string; event: StreamEvent }) => void
  ): () => void;

  // Events
  onToolsChanged(callback: () => void): () => void;
  onServersChanged(callback: () => void): () => void;
  onResourceUpdated(callback: (data: { uri: string; serverName: string }) => void): () => void;
  onConnectionError(callback: (data: { serverName: string; error: string }) => void): () => void;

  // Settings
  getSettings<T>(): Promise<T>;
  setSettings<T>(settings: T): Promise<void>;

  // Window controls (frameless window support)
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;
}

// Extend Window interface for TypeScript
declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
