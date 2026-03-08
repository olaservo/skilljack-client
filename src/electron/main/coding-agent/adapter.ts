/**
 * Coding Agent Adapter
 *
 * Interface and types for the coding agent integration.
 * The adapter abstracts the agent backend (pi subprocess via RPC,
 * or potentially a direct SDK integration in the future).
 */

// ============================================
// Configuration
// ============================================

export interface CodingAgentConfig {
  /** Path to pi CLI. Default: 'pi' (searches PATH) */
  cliPath?: string;
  /** Working directory for the agent. Defaults to main process cwd. */
  cwd?: string;
  /** LLM provider override (uses pi's default if omitted) */
  provider?: string;
  /** Model ID override (uses pi's default if omitted) */
  model?: string;
  /** Extra CLI args passed to pi */
  args?: string[];
  /** Environment variables (e.g. API keys) */
  env?: Record<string, string>;
  /** Timeout in ms. Default: 300000 (5 min) */
  timeout?: number;
}

// ============================================
// Agent Events (normalized from pi RPC events)
// ============================================

export type AgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_update'; toolCallId: string; partialResult: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'status'; message: string; detail?: Record<string, unknown> }
  | { type: 'complete'; usage?: AgentUsage }
  | { type: 'error'; message: string }
  | { type: 'set_status'; statusKey: string; statusText: string | undefined }
  | { type: 'set_widget'; widgetKey: string; widgetLines: string[] | undefined; widgetPlacement?: string }
  | { type: 'set_title'; title: string }
  | { type: 'ui_request'; id: string; method: string; [key: string]: unknown };

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}

// ============================================
// Extension UI Response Types
// ============================================

export type ExtensionUIResponse =
  | { type: 'extension_ui_response'; id: string; value: string }
  | { type: 'extension_ui_response'; id: string; confirmed: boolean }
  | { type: 'extension_ui_response'; id: string; cancelled: true };

// ============================================
// Adapter Interface
// ============================================

export interface CodingAgentAdapter {
  /** Start the agent process */
  start(config: CodingAgentConfig): Promise<void>;

  /** Execute a coding task. Returns an async iterable of events. */
  execute(task: string): AsyncIterable<AgentEvent>;

  /** Steer the agent mid-run */
  steer(message: string): Promise<void>;

  /** Abort the current task */
  abort(): Promise<void>;

  /** Stop the agent process entirely */
  stop(): Promise<void>;

  /** Check if agent is currently running a task */
  isRunning(): boolean;

  /** Respond to an extension UI request from the agent */
  respondToUIRequest(response: ExtensionUIResponse): Promise<void>;
}
