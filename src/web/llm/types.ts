/**
 * LLM API Types
 *
 * Request/response types for the chat API.
 */

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
  servers: ServerInfo[];
  availableTools: McpTool[];
}

export interface ServerInfo {
  name: string;
  version?: string;
  capabilities?: Record<string, unknown>;
}

export interface McpTool {
  name: string;              // Qualified name: "server__tool"
  originalName: string;      // Original name: "tool"
  serverName: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ChatSettings {
  provider: 'anthropic' | 'openai';
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

// SSE Stream Events
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call_start'; toolCall: ToolCallStart }
  | { type: 'tool_call_end'; toolCallId: string }
  | { type: 'error'; message: string }
  | { type: 'done'; usage?: TokenUsage };

export interface ToolCallStart {
  id: string;
  name: string;              // Qualified name
  displayName: string;       // Original name
  serverName: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// Theme tool types
export interface ThemeGenerateArgs {
  description: string;
  baseTheme?: string;
}

export interface ThemeTweakArgs {
  changes: Record<string, string>;
}

export interface ThemePreviewArgs {
  theme: Record<string, unknown>;
  duration?: number;
}
