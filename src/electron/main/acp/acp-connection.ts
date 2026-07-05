/**
 * ACP Agent Connection
 *
 * One instance per running agent process. Owns the child process, the
 * ClientSideConnection over ndjson stdio, per-session state (cwd +
 * merged tool-call views), and the translation of session/update
 * notifications into serializable AcpUiEvents for the renderer.
 */

import { app } from 'electron';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type InitializeResponse,
  type McpServer,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import log from 'electron-log';
import type {
  AcpAgentConfig,
  AcpAgentStatus,
  AcpNewSessionResult,
  AcpStopReason,
  AcpTerminalOutputResult,
  AcpToolCallView,
  AcpUiEvent,
} from '../../../shared/acp-types.js';
import { SkilljackAcpClient, type AcpClientDelegate } from './acp-client-impl.js';
import { killProcessTree, spawnAgentProcess } from './agent-spawner.js';
import type { PermissionBroker } from './permission-broker.js';
import { TerminalManager } from './terminal-manager.js';
import {
  mergeToolCallUpdate,
  toCommandViews,
  toConfigOptionViews,
  toModeStateView,
  toPartialToolCallView,
  toPermissionOptionViews,
  toPlanEntryViews,
  toToolCallView,
} from './type-converters.js';

const INITIALIZE_TIMEOUT_MS = 120_000;
/** npx cold-start of claude-agent-acp can exceed 30s on first run */
const NEW_SESSION_TIMEOUT_MS = 180_000;
const STDERR_TAIL_BYTES = 8 * 1024;

interface SessionState {
  cwd: string;
  toolCalls: Map<string, AcpToolCallView>;
  promptActive: boolean;
}

export interface AcpConnectionCallbacks {
  onSessionEvent: (sessionId: string, event: AcpUiEvent) => void;
  onStatusChanged: (status: AcpAgentStatus, error?: string, stderrTail?: string) => void;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export class AcpAgentConnection {
  private child: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private initResult: InitializeResponse | null = null;
  private sessions = new Map<string, SessionState>();
  private stderrTail = Buffer.alloc(0);
  private stopping = false;
  private turnCounter = 0;
  readonly terminals = new TerminalManager();

  constructor(
    readonly agentId: string,
    private config: AcpAgentConfig,
    private broker: PermissionBroker,
    private callbacks: AcpConnectionCallbacks
  ) {}

  get isAlive(): boolean {
    return (
      this.child !== null &&
      this.child.exitCode === null &&
      this.child.signalCode === null &&
      this.connection !== null
    );
  }

  /** Whether the agent accepts http-transport MCP servers in session/new */
  get supportsHttpMcp(): boolean {
    return this.initResult?.agentCapabilities?.mcpCapabilities?.http === true;
  }

  // ============================================
  // Lifecycle
  // ============================================

  async start(): Promise<void> {
    if (this.isAlive) return;

    this.callbacks.onStatusChanged('starting');
    const { child } = spawnAgentProcess(this.config);
    this.child = child;

    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = Buffer.concat([this.stderrTail, chunk]);
      if (this.stderrTail.length > STDERR_TAIL_BYTES) {
        this.stderrTail = this.stderrTail.subarray(this.stderrTail.length - STDERR_TAIL_BYTES);
      }
      log.info(`[ACP:${this.agentId}] stderr: ${chunk.toString('utf8').trimEnd()}`);
    });

    child.once('exit', (code, signal) => {
      log.info(`[ACP:${this.agentId}] agent exited (code=${code}, signal=${signal})`);
      this.handleAgentGone(
        this.stopping ? 'Agent stopped' : `Agent exited unexpectedly (code ${code ?? signal})`
      );
    });
    child.once('error', (err) => {
      log.error(`[ACP:${this.agentId}] spawn error:`, err);
      this.handleAgentGone(`Failed to start agent: ${err.message}`);
    });

    if (!child.stdin || !child.stdout) {
      throw new Error('Agent process is missing stdio pipes');
    }

    const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(input, output);

    const delegate: AcpClientDelegate = {
      handleSessionUpdate: (notification) => this.handleSessionUpdate(notification),
      requestPermission: (params) => this.handlePermissionRequest(params),
      getSessionCwd: (sessionId) => this.sessions.get(sessionId)?.cwd,
      terminals: this.terminals,
    };
    this.connection = new ClientSideConnection(() => new SkilljackAcpClient(delegate), stream);

    this.initResult = await withTimeout(
      this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: 'skilljack-client', version: app.getVersion() },
      }),
      INITIALIZE_TIMEOUT_MS,
      'initialize'
    );

    log.info(
      `[ACP:${this.agentId}] initialized (protocol v${this.initResult.protocolVersion}, ` +
        `authMethods: ${(this.initResult.authMethods ?? []).map((m) => m.id).join(', ') || 'none'})`
    );
    this.callbacks.onStatusChanged('running');
  }

  stop(): void {
    this.stopping = true;
    if (this.child) {
      killProcessTree(this.child);
    }
  }

  private handleAgentGone(reason: string): void {
    const wasStopping = this.stopping;
    this.connection = null;

    // Ordering matters: resolve permissions first so no card lingers,
    // then mark sessions dead, then flip the status.
    for (const sessionId of this.sessions.keys()) {
      this.broker.cancelSession(sessionId);
    }
    for (const sessionId of this.sessions.keys()) {
      this.callbacks.onSessionEvent(sessionId, { type: 'session_dead', reason });
    }
    this.sessions.clear();
    void this.terminals.shutdown();

    const stderrTail = this.stderrTail.toString('utf8');
    this.callbacks.onStatusChanged(
      wasStopping ? 'idle' : 'crashed',
      wasStopping ? undefined : reason,
      wasStopping ? undefined : stderrTail
    );
    this.child = null;
    this.stopping = false;
  }

  // ============================================
  // Sessions
  // ============================================

  async newSession(cwd: string, mcpServers: McpServer[]): Promise<AcpNewSessionResult> {
    if (!this.isAlive) {
      await this.start();
    }
    const connection = this.requireConnection();

    let result;
    try {
      result = await withTimeout(
        connection.newSession({ cwd, mcpServers }),
        NEW_SESSION_TIMEOUT_MS,
        'session/new'
      );
    } catch (err) {
      throw new Error(this.describeSessionError(err));
    }

    this.sessions.set(result.sessionId, {
      cwd,
      toolCalls: new Map(),
      promptActive: false,
    });

    return {
      sessionId: result.sessionId,
      agentId: this.agentId,
      cwd,
      modes: toModeStateView(result.modes),
      configOptions: toConfigOptionViews(result.configOptions),
    };
  }

  private describeSessionError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    const authMethods = this.initResult?.authMethods ?? [];
    if (/auth/i.test(message) && authMethods.length > 0) {
      const names = authMethods.map((m) => m.name || m.id).join(', ');
      return (
        `The agent requires authentication (${names}). ` +
        `Log in with the agent's own CLI (e.g. "claude login") or set the required ` +
        `API key in the agent's env config in Settings, then try again. (${message})`
      );
    }
    return message;
  }

  /**
   * Fire the prompt in the background; the outcome arrives on the session
   * event stream as turn_ended / turn_error.
   */
  prompt(sessionId: string, text: string): string {
    const connection = this.requireConnection();
    const session = this.requireSession(sessionId);
    if (session.promptActive) {
      throw new Error('A prompt is already in progress for this session');
    }

    const turnId = `turn-${++this.turnCounter}`;
    session.promptActive = true;
    this.callbacks.onSessionEvent(sessionId, { type: 'turn_started', turnId });

    connection
      .prompt({ sessionId, prompt: [{ type: 'text', text }] })
      .then((result) => {
        session.promptActive = false;
        this.callbacks.onSessionEvent(sessionId, {
          type: 'turn_ended',
          turnId,
          stopReason: result.stopReason as AcpStopReason,
        });
      })
      .catch((err) => {
        session.promptActive = false;
        // Session death already emits session_dead; still surface the turn error
        this.callbacks.onSessionEvent(sessionId, {
          type: 'turn_error',
          turnId,
          message: err instanceof Error ? err.message : String(err),
        });
      });

    return turnId;
  }

  async cancel(sessionId: string): Promise<void> {
    const connection = this.requireConnection();
    // Spec: pending permission requests MUST resolve as cancelled when cancelling
    this.broker.cancelSession(sessionId);
    await connection.cancel({ sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.requireConnection().setSessionMode({ sessionId, modeId });
  }

  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<void> {
    const result = await this.requireConnection().setSessionConfigOption({
      sessionId,
      configId,
      value,
    } as Parameters<ClientSideConnection['setSessionConfigOption']>[0]);
    // Response carries the full config state; forward it so the UI stays in sync
    const options = (result as { configOptions?: unknown })?.configOptions;
    if (Array.isArray(options)) {
      this.callbacks.onSessionEvent(sessionId, {
        type: 'config_options',
        options: toConfigOptionViews(options as Parameters<typeof toConfigOptionViews>[0]),
      });
    }
  }

  getTerminalOutput(terminalId: string): AcpTerminalOutputResult {
    return this.terminals.getOutput(terminalId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  // ============================================
  // Incoming from agent
  // ============================================

  private handleSessionUpdate(notification: SessionNotification): void {
    const { sessionId, update } = notification;
    const session = this.sessions.get(sessionId);
    if (!session) {
      log.warn(`[ACP:${this.agentId}] update for unknown session ${sessionId}`);
      return;
    }
    const emit = (event: AcpUiEvent) => this.callbacks.onSessionEvent(sessionId, event);

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          emit({ type: 'agent_chunk', text: update.content.text });
        }
        break;
      case 'agent_thought_chunk':
        if (update.content.type === 'text') {
          emit({ type: 'thought_chunk', text: update.content.text });
        }
        break;
      case 'user_message_chunk':
        // The renderer already shows the user's message
        break;
      case 'tool_call': {
        const view = toToolCallView(update);
        session.toolCalls.set(view.toolCallId, view);
        emit({ type: 'tool_call_upsert', toolCall: view });
        break;
      }
      case 'tool_call_update': {
        const existing = session.toolCalls.get(update.toolCallId);
        const view = existing
          ? mergeToolCallUpdate(existing, update)
          : toPartialToolCallView(update);
        session.toolCalls.set(view.toolCallId, view);
        emit({ type: 'tool_call_upsert', toolCall: view });
        break;
      }
      case 'plan':
        emit({ type: 'plan', entries: toPlanEntryViews(update.entries) });
        break;
      case 'plan_removed':
        emit({ type: 'plan', entries: null });
        break;
      case 'available_commands_update':
        emit({ type: 'available_commands', commands: toCommandViews(update.availableCommands) });
        break;
      case 'current_mode_update':
        emit({ type: 'mode_changed', currentModeId: update.currentModeId });
        break;
      case 'config_option_update':
        emit({ type: 'config_options', options: toConfigOptionViews(update.configOptions) });
        break;
      case 'usage_update':
        emit({
          type: 'usage',
          usage: { used: update.used, size: update.size, cost: update.cost ?? undefined },
        });
        break;
      default:
        // plan_update (unstable), session_info_update, unknown future kinds
        break;
    }
  }

  private async handlePermissionRequest(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const session = this.sessions.get(params.sessionId);
    // Keep the tool-call view current — permission requests carry an update
    let toolCallView: AcpToolCallView;
    const existing = session?.toolCalls.get(params.toolCall.toolCallId);
    if (existing) {
      toolCallView = mergeToolCallUpdate(existing, params.toolCall);
    } else {
      toolCallView = toPartialToolCallView(params.toolCall);
    }
    session?.toolCalls.set(toolCallView.toolCallId, toolCallView);
    this.callbacks.onSessionEvent(params.sessionId, {
      type: 'tool_call_upsert',
      toolCall: toolCallView,
    });

    const outcome = await this.broker.request({
      sessionId: params.sessionId,
      toolCallId: params.toolCall.toolCallId,
      toolCall: toolCallView,
      options: toPermissionOptionViews(params.options),
    });

    return { outcome };
  }

  private requireConnection(): ClientSideConnection {
    if (!this.connection) {
      throw new Error('Agent is not running');
    }
    return this.connection;
  }

  private requireSession(sessionId: string): SessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }
}
