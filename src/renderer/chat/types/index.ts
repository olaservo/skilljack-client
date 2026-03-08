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

/**
 * Standard chat message (user, assistant, or system).
 * Part of the ChatMessage discriminated union.
 */
export interface ChatTextMessage {
  type: 'text';
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

// ============================================
// Agent Run Types
// ============================================

/** A complete or in-progress coding agent run, displayed as a single chat message */
export interface AgentRunMessage {
  type: 'agent-run';
  id: string;
  timestamp: string;
  task: string;
  status: 'running' | 'completed' | 'aborted' | 'error';
  error?: string;
  blocks: AgentBlock[];
  title?: string;
  statuses: Record<string, string>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  };
  model?: {
    provider: string;
    id: string;
  };
}

/** A single block of agent output */
export type AgentBlock =
  | AgentTextBlock
  | AgentToolBlock
  | AgentThinkingBlock
  | AgentStatusBlock;

export interface AgentTextBlock {
  type: 'text';
  content: string;
}

export interface AgentToolBlock {
  type: 'tool';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  result?: {
    content: unknown;
    isError: boolean;
  };
}

export interface AgentThinkingBlock {
  type: 'thinking';
  content: string;
}

export interface AgentStatusBlock {
  type: 'status';
  message: string;
}

/** Top-level state for the active agent run (null when no agent is running) */
export interface AgentRunState {
  messageId: string;
  task: string;
  canSteer: boolean;
  canAbort: boolean;
}

/**
 * Discriminated union of all chat message types.
 * Use `message.type` to narrow: 'text' for standard messages, 'agent-run' for agent runs.
 */
export type ChatMessage = ChatTextMessage | AgentRunMessage;

/** Type guard: is this a standard text message? */
export function isTextMessage(msg: ChatMessage): msg is ChatTextMessage {
  return msg.type === 'text';
}

/** Type guard: is this an agent run message? */
export function isAgentRunMessage(msg: ChatMessage): msg is AgentRunMessage {
  return msg.type === 'agent-run';
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
  /** Active coding agent run. Null when no agent is running. */
  agentRun: AgentRunState | null;
}

export type ChatAction =
  | { type: 'TOGGLE_DRAWER' }
  | { type: 'OPEN_DRAWER' }
  | { type: 'CLOSE_DRAWER' }
  | { type: 'SET_INPUT'; value: string }
  | { type: 'ADD_TO_HISTORY'; value: string }
  | { type: 'NAVIGATE_HISTORY'; direction: 'up' | 'down' }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'UPDATE_MESSAGE'; id: string; updates: Partial<ChatTextMessage> }
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
  | { type: 'RESET_TURN' }
  // --- Agent Run Lifecycle ---
  | { type: 'AGENT_RUN_START'; task: string; messageId: string; model?: { provider: string; id: string } }
  | { type: 'AGENT_RUN_COMPLETE'; messageId: string; usage?: AgentRunMessage['usage'] }
  | { type: 'AGENT_RUN_ERROR'; messageId: string; error: string }
  | { type: 'AGENT_RUN_ABORT'; messageId: string }
  // --- Agent Run Content ---
  | { type: 'AGENT_BLOCK_TEXT_DELTA'; messageId: string; delta: string }
  | { type: 'AGENT_BLOCK_THINKING_DELTA'; messageId: string; delta: string }
  | { type: 'AGENT_BLOCK_TOOL_START'; messageId: string; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'AGENT_BLOCK_TOOL_END'; messageId: string; toolCallId: string; result: unknown; isError: boolean }
  | { type: 'AGENT_BLOCK_STATUS'; messageId: string; message: string }
  // --- Agent Run Metadata ---
  | { type: 'AGENT_SET_STATUS'; messageId: string; statusKey: string; statusText: string | undefined }
  | { type: 'AGENT_SET_TITLE'; messageId: string; title: string };

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
