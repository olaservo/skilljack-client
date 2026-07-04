/**
 * ACP (Agent Client Protocol) Shared Types
 *
 * Plain serializable mirrors of the ACP protocol types that cross the
 * IPC boundary. The renderer must never import @agentclientprotocol/sdk
 * (a Node package) — only the main process does. Converters in
 * src/electron/main/acp/ translate SDK types into these views.
 */

// ============================================
// Agent Registry
// ============================================

export interface AcpAgentConfig {
  /** Human-readable name shown in the backend selector */
  displayName: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Working directory for the agent process itself (optional) */
  cwd?: string | null;
  /** Last-used / preferred session working directory */
  defaultSessionCwd?: string | null;
  enabled: boolean;
  /** Built-in agents can be edited but not removed */
  builtIn?: boolean;
}

export interface AcpAgentInfo extends AcpAgentConfig {
  id: string;
  status: AcpAgentStatus;
}

export type AcpAgentStatus = 'idle' | 'starting' | 'running' | 'crashed';

export interface AcpAgentStatusPayload {
  agentId: string;
  status: AcpAgentStatus;
  error?: string;
  /** Tail of the agent's stderr, for diagnostics when crashed */
  stderrTail?: string;
}

// ============================================
// Tool Calls
// ============================================

export type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

export type AcpToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** Serializable content block (text/image subset we render) */
export interface AcpContentBlockView {
  type: string;
  text?: string;
  /** For resource_link / resource blocks */
  uri?: string;
  name?: string;
}

export type AcpToolCallContentView =
  | { type: 'content'; block: AcpContentBlockView }
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: 'terminal'; terminalId: string };

export interface AcpToolCallLocationView {
  path: string;
  line?: number | null;
}

export interface AcpToolCallView {
  toolCallId: string;
  title: string;
  kind: AcpToolKind;
  status: AcpToolCallStatus;
  contentBlocks: AcpToolCallContentView[];
  locations: AcpToolCallLocationView[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

// ============================================
// Plans, Commands, Modes, Config Options
// ============================================

export interface AcpPlanEntryView {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface AcpCommandView {
  name: string;
  description?: string;
  inputHint?: string;
}

export interface AcpModeView {
  id: string;
  name: string;
  description?: string;
}

export interface AcpModeStateView {
  currentModeId: string;
  availableModes: AcpModeView[];
}

export interface AcpConfigOptionValueView {
  value: string;
  name: string;
  description?: string;
}

export interface AcpConfigOptionView {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: 'select' | 'boolean';
  currentValue: string | boolean | null;
  options: AcpConfigOptionValueView[];
}

// ============================================
// Permissions
// ============================================

export type AcpPermissionOptionKind =
  | 'allow_once'
  | 'allow_always'
  | 'reject_once'
  | 'reject_always';

export interface AcpPermissionOptionView {
  optionId: string;
  name: string;
  kind: AcpPermissionOptionKind;
}

export interface AcpPermissionRequestPayload {
  requestId: string;
  sessionId: string;
  toolCallId: string;
  /** The tool call requiring permission (may be partial) */
  toolCall: Partial<AcpToolCallView> & { toolCallId: string };
  options: AcpPermissionOptionView[];
}

export type AcpPermissionOutcome =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' };

// ============================================
// Session Events (main → renderer stream)
// ============================================

export type AcpStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

export type AcpUiEvent =
  | { type: 'turn_started'; turnId: string }
  | { type: 'agent_chunk'; text: string }
  | { type: 'thought_chunk'; text: string }
  | { type: 'tool_call_upsert'; toolCall: AcpToolCallView }
  | { type: 'plan'; entries: AcpPlanEntryView[] | null }
  | { type: 'available_commands'; commands: AcpCommandView[] }
  | { type: 'mode_changed'; currentModeId: string }
  | { type: 'config_options'; options: AcpConfigOptionView[] }
  | { type: 'usage'; usage: Record<string, unknown> }
  | { type: 'permission_resolved'; requestId: string }
  | { type: 'turn_ended'; turnId: string; stopReason: AcpStopReason }
  | { type: 'turn_error'; turnId: string; message: string }
  | { type: 'session_dead'; reason: string };

export interface AcpSessionUpdatePayload {
  sessionId: string;
  event: AcpUiEvent;
}

// ============================================
// Session Creation
// ============================================

export interface AcpNewSessionResult {
  sessionId: string;
  agentId: string;
  cwd: string;
  modes: AcpModeStateView | null;
  configOptions: AcpConfigOptionView[];
}

/** Request from main to open an MCP App panel (e.g. agent asked for the config UI) */
export interface AcpOpenAppPayload {
  serverName: string;
  uiResourceUri: string;
}

export interface AcpTerminalOutputResult {
  output: string;
  truncated: boolean;
  exitStatus?: { exitCode?: number | null; signal?: string | null } | null;
}
