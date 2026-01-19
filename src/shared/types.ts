/**
 * Shared Types
 *
 * API and IPC contract types shared between web (HTTP) and Electron (IPC) modes.
 * These types define the communication interface between renderer and backend.
 */

// ============================================
// Server Types
// ============================================

export interface ServerInfo {
  name: string;
  version?: string;
  toolCount: number;
  capabilities?: Record<string, unknown>;
}

export interface ServerSummary {
  name: string;
  version?: string;
  status: 'connected' | 'connecting' | 'error';
  toolCount: number;
}

// ============================================
// Tool Types
// ============================================

export interface ToolWithUIInfo {
  /** Qualified name for API calls (server__tool) */
  name: string;
  /** Original tool name for display */
  displayName: string;
  description?: string;
  hasUi: boolean;
  uiResourceUri?: string;
  serverName: string;
}

export interface ToolWithEnabledState extends ToolWithUIInfo {
  enabled: boolean;
}

export interface McpTool {
  /** Qualified name: "server__tool" */
  name: string;
  /** Original name: "tool" */
  originalName: string;
  serverName: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  hasUi?: boolean;
  uiResourceUri?: string;
}

export interface ToolCallResult {
  content: unknown;
  isError?: boolean;
  serverName?: string;
}

// ============================================
// Resource Types
// ============================================

export interface ResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverName: string;
}

export interface UIResource {
  uri: string;
  mimeType: string;
  text: string;
  serverName: string;
}

// ============================================
// Prompt Types
// ============================================

export interface PromptInfo {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
  serverName: string;
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

// ============================================
// Chat API Types
// ============================================

export interface ChatRequest {
  sessionId: string;
  messages: ChatApiMessage[];
  mcpContext: McpContext;
  settings: ChatSettings;
}

export interface ChatApiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCallInfo[];
  toolResults?: ToolResultInfo[];
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultInfo {
  toolCallId: string;
  content: unknown;
  isError?: boolean;
}

export interface McpContext {
  servers: Pick<ServerInfo, 'name' | 'version'>[];
  availableTools: McpTool[];
}

export interface ChatSettings {
  provider: 'anthropic' | 'openai';
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;
  systemPrompt?: string;
}

// ============================================
// SSE Stream Events
// ============================================

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call_start'; toolCall: ToolCallStart }
  | { type: 'tool_call_end'; toolCallId: string }
  | { type: 'error'; message: string }
  | { type: 'done'; usage?: TokenUsage };

export interface ToolCallStart {
  id: string;
  name: string;
  displayName: string;
  serverName: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// ============================================
// WebSocket Event Types
// ============================================

export type WebSocketEvent =
  | { type: 'tools_changed' }
  | { type: 'servers_changed' }
  | { type: 'resource_updated'; uri: string; serverName: string }
  | { type: 'connection_error'; serverName: string; error: string };

// ============================================
// Config Types
// ============================================

export interface WebConfig {
  sandboxPort: number;
  multiServer: boolean;
  serverCount: number;
}

// ============================================
// Server State Types (for Tool Manager)
// ============================================

export interface ServerWithState {
  name: string;
  enabled: boolean;
  toolCount: number;
  enabledToolCount: number;
}
