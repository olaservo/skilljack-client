/**
 * Chat Types
 *
 * Type definitions for the chat drawer and theme system.
 */

// ============================================
// Message Types
// ============================================

/**
 * Model configuration stored with assistant messages for continuation
 */
export interface MessageModelConfig {
  provider: 'anthropic' | 'openai';
  modelId: string;
  temperature: number;
  maxTurns: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: ChatToolCall[];
  isStreaming?: boolean;
  error?: string;
  /** Model config for assistant messages - used for multi-turn continuation */
  modelConfig?: MessageModelConfig;
}

export interface ChatToolCall {
  id: string;
  qualifiedName: string;     // "server__tool" - for API calls
  displayName: string;       // "tool" - for UI display
  serverName: string;        // "server" - for badges
  arguments: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: ToolCallResult;
  annotations?: {            // Tool behavior annotations
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface ToolCallResult {
  content: unknown;
  isError?: boolean;
}

// ============================================
// Server Types
// ============================================

/**
 * Server lifecycle status values.
 * Maps to ServerStatus from @skilljack/mcp-server-manager
 */
export type ServerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'unhealthy'
  | 'restarting'
  | 'failed'
  | 'stopped';

export interface ServerInfo {
  name: string;
  version?: string;
  status: ServerStatus;
  toolCount: number;
  capabilities?: Record<string, unknown>;
  /** Number of health checks passed (when healthy) */
  healthChecksPassed?: number;
  /** Number of consecutive health check failures */
  healthChecksFailed?: number;
  /** Current restart attempt number (when restarting) */
  restartAttempts?: number;
  /** Maximum restart attempts allowed */
  maxRestartAttempts?: number;
  /** Last error message (when failed/unhealthy) */
  lastError?: string;
}

export interface McpTool {
  name: string;              // Qualified name: "server__tool"
  originalName: string;      // Original name: "tool"
  serverName: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  hasUi?: boolean;           // Tool has MCP App UI
  uiResourceUri?: string;    // URI of UI resource
  annotations?: {            // Tool behavior annotations
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface McpContext {
  servers: ServerInfo[];
  availableTools: McpTool[];
}

// ============================================
// Chat State
// ============================================

export interface ChatState {
  isOpen: boolean;
  sessionId: string;
  messages: ChatMessage[];
  inputValue: string;
  inputHistory: string[];
  historyIndex: number;
  isProcessing: boolean;
  streamingMessageId: string | null;
  servers: ServerInfo[];
  tools: McpTool[];
  activeServers: string[] | null;  // null = all servers
  error: string | null;
  /** Current turn in multi-turn tool workflow (0 = first turn) */
  currentTurn: number;
}

export type ChatAction =
  | { type: 'TOGGLE_DRAWER' }
  | { type: 'OPEN_DRAWER' }
  | { type: 'CLOSE_DRAWER' }
  | { type: 'SET_INPUT'; value: string }
  | { type: 'ADD_TO_HISTORY'; value: string }
  | { type: 'NAVIGATE_HISTORY'; direction: 'up' | 'down' }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'UPDATE_MESSAGE'; id: string; updates: Partial<ChatMessage> }
  | { type: 'APPEND_STREAM'; id: string; content: string }
  | { type: 'APPEND_TOOL_CALLS'; messageId: string; toolCalls: ChatToolCall[] }
  | { type: 'UPDATE_TOOL_CALL'; messageId: string; toolCallId: string; updates: Partial<ChatToolCall> }
  | { type: 'SET_PROCESSING'; isProcessing: boolean }
  | { type: 'SET_STREAMING_MESSAGE'; id: string | null }
  | { type: 'SET_SERVERS'; servers: ServerInfo[] }
  | { type: 'UPDATE_SERVER_STATUS'; serverName: string; updates: Partial<ServerInfo> }
  | { type: 'SET_TOOLS'; tools: McpTool[] }
  | { type: 'FILTER_SERVERS'; serverNames: string[] | null }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'NEW_SESSION' }
  | { type: 'INCREMENT_TURN' }
  | { type: 'RESET_TURN' };

// ============================================
// Theme Types
// ============================================

export interface Theme {
  id: string;
  name: string;
  author?: string;
  version?: string;
  previewImage?: string;
  variables: ThemeVariables;
  customCss?: string;
}

export interface ThemeVariables {
  // Colors - Primary
  '--bg-primary': string;
  '--bg-secondary': string;
  '--bg-panel': string;
  '--bg-hover': string;
  '--bg-active': string;

  // Colors - Text
  '--text-primary': string;
  '--text-secondary': string;
  '--text-muted': string;

  // Colors - Accent
  '--accent': string;
  '--accent-hover': string;
  '--accent-muted': string;

  // Colors - Semantic
  '--success': string;
  '--error': string;
  '--warning': string;
  '--info': string;

  // Colors - Borders
  '--border': string;
  '--border-hover': string;

  // Typography
  '--font-family': string;
  '--font-mono': string;
  '--font-size-base': string;

  // Spacing & Borders
  '--radius-sm': string;
  '--radius-md': string;
  '--radius-lg': string;
  '--radius-full': string;

  // Shadows
  '--shadow-sm': string;
  '--shadow-md': string;
  '--shadow-lg': string;
  '--shadow-drawer': string;

  // Special effects (for retro themes)
  '--bezel-light': string;
  '--bezel-dark': string;
  '--glow': string;
  '--scanlines': string;
}

export interface ThemeState {
  activeTheme: Theme;
  previewTheme: Theme | null;
  isEditing: boolean;
  availableThemes: Theme[];
  customThemes: Theme[];
}

export type ThemeAction =
  | { type: 'SET_THEME'; theme: Theme }
  | { type: 'PREVIEW_THEME'; theme: Theme | null }
  | { type: 'APPLY_PREVIEW' }
  | { type: 'CANCEL_PREVIEW' }
  | { type: 'SET_EDITING'; isEditing: boolean }
  | { type: 'ADD_CUSTOM_THEME'; theme: Theme }
  | { type: 'REMOVE_CUSTOM_THEME'; id: string }
  | { type: 'UPDATE_VARIABLE'; key: keyof ThemeVariables; value: string };

// ============================================
// Settings
// ============================================

export interface ChatSettings {
  provider: 'anthropic' | 'openai';
  modelId: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  autoExecuteTools: boolean;
  /** If true, always prompt for confirmation before executing dangerous tools */
  confirmDangerousTools: boolean;
}
