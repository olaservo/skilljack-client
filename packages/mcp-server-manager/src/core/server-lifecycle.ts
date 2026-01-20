/**
 * Server lifecycle state machine for MCP servers
 */

import { EventEmitter } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  ServerConfig,
  LifecycleConfig,
  StdioServerConfig,
  HttpServerConfig,
} from '../types/config.js';
import { resolveLifecycleConfig } from '../types/config.js';
import type {
  ServerState,
  ServerStatus,
  HealthCheckResult,
  ServerStateSummary,
} from '../types/state.js';
import { createInitialState, toStateSummary } from '../types/state.js';
import type { LifecycleEvent, LifecycleEventMap } from '../types/events.js';
import { HealthMonitor } from './health-monitor.js';
import { ProcessManager } from './process-manager.js';
import { HttpConnection } from './http-connection.js';
import { calculateBackoff, delay } from '../utils/retry.js';
import { createLogger, type Logger } from '../utils/logger.js';

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<ServerStatus, ServerStatus[]> = {
  disconnected: ['connecting', 'stopped'],
  connecting: ['connected', 'failed', 'stopped'],
  connected: ['unhealthy', 'disconnected', 'stopped'],
  unhealthy: ['connected', 'restarting', 'stopped'],
  restarting: ['connecting', 'failed', 'stopped'],
  failed: ['connecting', 'stopped'],
  stopped: ['connecting'],
};

/**
 * Manages the complete lifecycle of a single MCP server
 */
export class ServerLifecycle extends EventEmitter {
  readonly name: string;
  private config: ServerConfig;
  private lifecycleConfig: Required<LifecycleConfig>;
  private logger: Logger;

  private state: ServerState;
  private client: Client | null = null;
  private transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
  private processManager: ProcessManager | null = null;
  private httpConnection: HttpConnection | null = null;
  private healthMonitor: HealthMonitor | null = null;

  private restartInProgress = false;
  private stopRequested = false;

  constructor(
    config: ServerConfig,
    globalDefaults?: LifecycleConfig,
    logger?: Logger
  ) {
    super();
    this.name = config.name;
    this.config = config;
    this.lifecycleConfig = resolveLifecycleConfig(config.lifecycle, globalDefaults);
    this.state = createInitialState();
    this.logger = logger ?? createLogger(`ServerLifecycle:${config.name}`);
  }

  /**
   * Gets the current server state
   */
  getState(): ServerState {
    return { ...this.state };
  }

  /**
   * Gets a summary of the current state
   */
  getStateSummary(): ServerStateSummary {
    return toStateSummary(this.name, this.state);
  }

  /**
   * Gets the MCP client (if connected)
   */
  getClient(): Client | null {
    return this.client;
  }

  /**
   * Gets the current status
   */
  getStatus(): ServerStatus {
    return this.state.status;
  }

  /**
   * Starts the server connection
   */
  async start(): Promise<void> {
    if (this.state.status !== 'disconnected' && this.state.status !== 'failed') {
      this.logger.warn('Cannot start server in current state', {
        status: this.state.status,
      });
      return;
    }

    this.stopRequested = false;
    await this.connect();
  }

  /**
   * Stops the server gracefully
   */
  async stop(): Promise<void> {
    this.stopRequested = true;
    this.logger.info('Stopping server');

    // Stop health monitoring
    this.healthMonitor?.stop();

    const wasConnected = this.state.status === 'connected' || this.state.status === 'unhealthy';

    // Close client connection
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        this.logger.warn('Error closing client', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.client = null;
    }

    // Close transport
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        this.logger.warn('Error closing transport', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.transport = null;
    }

    // Stop process for stdio servers
    if (this.processManager) {
      await this.processManager.stop();
      this.processManager = null;
    }

    // Mark HTTP connection as disconnected
    if (this.httpConnection) {
      this.httpConnection.markDisconnected();
    }

    this.transitionTo('stopped');
    this.emitEvent({
      type: 'server:stopped',
      serverName: this.name,
      timestamp: new Date(),
      graceful: wasConnected,
    });
  }

  /**
   * Manually triggers a restart
   */
  async restart(): Promise<void> {
    this.logger.info('Manual restart requested');
    await this.performRestart('manual');
  }

  /**
   * Connects to the server
   */
  private async connect(): Promise<void> {
    this.transitionTo('connecting');
    this.emitEvent({
      type: 'server:connecting',
      serverName: this.name,
      timestamp: new Date(),
    });

    try {
      if (this.config.connection.type === 'stdio') {
        await this.connectStdio(this.config.connection);
      } else {
        await this.connectHttp(this.config.connection);
      }

      // Initialize client
      this.client = new Client({
        name: `mcp-manager-${this.name}`,
        version: '1.0.0',
      });

      await this.client.connect(this.transport!);

      // Update state
      this.transitionTo('connected');
      this.state.pid = this.processManager?.getPid();

      this.emitEvent({
        type: 'server:connected',
        serverName: this.name,
        timestamp: new Date(),
        pid: this.state.pid,
      });

      // Start health monitoring if enabled
      if (this.lifecycleConfig.healthCheckEnabled) {
        this.startHealthMonitoring();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Connection failed', { error: errorMessage });

      this.state.error = errorMessage;
      this.transitionTo('failed');

      this.emitEvent({
        type: 'server:connection-failed',
        serverName: this.name,
        timestamp: new Date(),
        error: errorMessage,
      });
    }
  }

  /**
   * Connects using stdio transport
   */
  private async connectStdio(config: StdioServerConfig): Promise<void> {
    this.processManager = new ProcessManager(
      this.name,
      config,
      this.lifecycleConfig.shutdownTimeoutMs,
      this.logger
    );

    // Set up process event handlers
    this.processManager.on('exited', (code, signal) => {
      this.handleProcessExit(code, signal);
    });

    this.processManager.on('error', (error) => {
      this.logger.error('Process error', { error: error.message });
    });

    // Start the process
    const proc = await this.processManager.start();

    // Create stdio transport
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      // Pass the existing process streams
      // Note: The SDK's StdioClientTransport expects to spawn its own process,
      // so we may need to refactor this for proper integration
    });
  }

  /**
   * Connects using HTTP transport
   */
  private async connectHttp(config: HttpServerConfig): Promise<void> {
    this.httpConnection = new HttpConnection(this.name, config, this.logger);

    // Validate configuration
    const validation = this.httpConnection.validate();
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Create HTTP transport
    this.transport = new StreamableHTTPClientTransport(new URL(config.url));

    this.httpConnection.markConnected();
  }

  /**
   * Handles process exit for stdio servers
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    // Don't handle if we requested the stop
    if (this.stopRequested) {
      return;
    }

    this.logger.warn('Process exited unexpectedly', { code, signal });

    const willRestart =
      this.lifecycleConfig.autoRestartEnabled &&
      this.state.restartStats.attempts < this.lifecycleConfig.maxRestartAttempts;

    this.emitEvent({
      type: 'server:crashed',
      serverName: this.name,
      timestamp: new Date(),
      exitCode: code,
      signal,
      willRestart,
    });

    // Clean up client
    this.client = null;
    this.transport = null;
    this.processManager = null;

    if (willRestart) {
      void this.performRestart('crashed');
    } else {
      this.transitionTo('failed');
      this.state.error = `Process exited with code ${code}, signal ${signal}`;
    }
  }

  /**
   * Starts health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthMonitor = new HealthMonitor(
      this.name,
      {
        intervalMs: this.lifecycleConfig.healthCheckIntervalMs,
        timeoutMs: this.lifecycleConfig.healthCheckTimeoutMs,
        unhealthyThreshold: this.lifecycleConfig.unhealthyThreshold,
      },
      {
        onHealthCheck: (result) => this.handleHealthCheck(result),
        onUnhealthy: (failures, result) => this.handleUnhealthy(failures, result),
        onRecovered: (result) => this.handleRecovered(result),
      },
      this.logger
    );

    this.healthMonitor.setClient(this.client);
    this.healthMonitor.start();
  }

  /**
   * Handles a health check result
   */
  private handleHealthCheck(result: HealthCheckResult): void {
    this.state.lastHealthCheck = result;
    this.state.consecutiveHealthCheckFailures = this.healthMonitor?.getConsecutiveFailures() ?? 0;
  }

  /**
   * Handles transition to unhealthy state
   */
  private handleUnhealthy(consecutiveFailures: number, lastResult: HealthCheckResult): void {
    if (this.state.status !== 'connected') {
      return;
    }

    this.transitionTo('unhealthy');
    this.emitEvent({
      type: 'server:unhealthy',
      serverName: this.name,
      timestamp: new Date(),
      consecutiveFailures,
      lastHealthCheck: lastResult,
    });

    // Trigger restart if auto-restart is enabled
    if (this.lifecycleConfig.autoRestartEnabled) {
      void this.performRestart('unhealthy');
    }
  }

  /**
   * Handles recovery from unhealthy state
   */
  private handleRecovered(result: HealthCheckResult): void {
    if (this.state.status === 'unhealthy') {
      this.transitionTo('connected');
      this.emitEvent({
        type: 'server:healthy',
        serverName: this.name,
        timestamp: new Date(),
        healthCheck: result,
      });
    }
  }

  /**
   * Performs a restart with backoff
   */
  private async performRestart(
    reason: 'crashed' | 'unhealthy' | 'manual'
  ): Promise<void> {
    if (this.restartInProgress || this.stopRequested) {
      return;
    }

    this.restartInProgress = true;

    // Stop health monitoring during restart
    this.healthMonitor?.stop();

    // Clean up existing connections
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Ignore errors during cleanup
      }
      this.client = null;
    }

    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Ignore errors during cleanup
      }
      this.transport = null;
    }

    this.transitionTo('restarting');

    const maxAttempts = this.lifecycleConfig.maxRestartAttempts;
    let attempt = this.state.restartStats.attempts;

    while (attempt < maxAttempts && !this.stopRequested) {
      attempt++;
      this.state.restartStats.attempts = attempt;
      this.state.restartStats.lastAttempt = new Date();

      this.emitEvent({
        type: 'server:restarting',
        serverName: this.name,
        timestamp: new Date(),
        attempt,
        maxAttempts,
        reason,
      });

      // Calculate backoff delay
      const backoffMs = calculateBackoff(attempt - 1, {
        baseMs: this.lifecycleConfig.restartBackoffBaseMs,
        maxMs: this.lifecycleConfig.restartBackoffMaxMs,
      });

      this.logger.info('Waiting before restart attempt', {
        attempt,
        maxAttempts,
        backoffMs,
      });

      await delay(backoffMs);

      if (this.stopRequested) {
        break;
      }

      try {
        await this.connect();

        if (this.state.status === 'connected') {
          this.state.restartStats.lastSuccess = true;
          this.state.restartStats.attempts = 0; // Reset on success

          this.emitEvent({
            type: 'server:restart-succeeded',
            serverName: this.name,
            timestamp: new Date(),
            attempts: attempt,
            pid: this.state.pid,
          });

          this.restartInProgress = false;
          return;
        }
      } catch (error) {
        this.logger.warn('Restart attempt failed', {
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Max attempts reached or stop requested
    this.restartInProgress = false;

    if (!this.stopRequested) {
      this.state.restartStats.lastSuccess = false;
      this.state.error = `Failed to restart after ${attempt} attempts`;
      this.transitionTo('failed');

      this.emitEvent({
        type: 'server:restart-failed',
        serverName: this.name,
        timestamp: new Date(),
        attempts: attempt,
        error: this.state.error,
      });
    }
  }

  /**
   * Transitions to a new status
   */
  private transitionTo(newStatus: ServerStatus): void {
    const previousStatus = this.state.status;

    // Validate transition
    if (!VALID_TRANSITIONS[previousStatus].includes(newStatus)) {
      this.logger.warn('Invalid state transition', {
        from: previousStatus,
        to: newStatus,
      });
      return;
    }

    this.state.status = newStatus;
    this.state.statusChangedAt = new Date();

    this.logger.debug('State transition', {
      from: previousStatus,
      to: newStatus,
    });

    this.emitEvent({
      type: 'server:status-changed',
      serverName: this.name,
      timestamp: new Date(),
      previousStatus,
      newStatus,
    });
  }

  /**
   * Emits a lifecycle event
   */
  private emitEvent<T extends keyof LifecycleEventMap>(event: LifecycleEventMap[T]): void {
    this.emit(event.type, event);
    this.emit('*', event);
  }

  /**
   * Adds an event listener for lifecycle events.
   * Use '*' to listen to all events.
   */
  onLifecycleEvent<T extends keyof LifecycleEventMap>(
    event: T,
    listener: (e: LifecycleEventMap[T]) => void
  ): this {
    return super.on(event, listener);
  }

  /**
   * Adds a one-time event listener for lifecycle events.
   */
  onceLifecycleEvent<T extends keyof LifecycleEventMap>(
    event: T,
    listener: (e: LifecycleEventMap[T]) => void
  ): this {
    return super.once(event, listener);
  }

  /**
   * Adds a listener for all lifecycle events.
   */
  onAnyEvent(listener: (e: LifecycleEvent) => void): this {
    return super.on('*', listener);
  }
}
