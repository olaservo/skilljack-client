/**
 * MCP Server Manager
 *
 * A loosely coupled lifecycle manager for MCP servers with health checks,
 * auto-restart, and graceful shutdown capabilities.
 *
 * @example
 * ```typescript
 * import { ServerManager, createServerConfig, createStdioConfig } from '@skilljack/mcp-server-manager';
 *
 * // Create a manager with server configurations
 * const manager = ServerManager.fromConfig({
 *   servers: [
 *     createServerConfig('my-server', createStdioConfig('node', ['server.js']))
 *   ]
 * });
 *
 * // Listen for events
 * manager.on('server:connected', (event) => {
 *   console.log(`Server ${event.serverName} connected`);
 * });
 *
 * // Start all servers
 * await manager.start();
 *
 * // Use the MCP client
 * const client = manager.getClient('my-server');
 * if (client) {
 *   const tools = await client.listTools();
 * }
 *
 * // Graceful shutdown
 * await manager.shutdown();
 * ```
 */

// Types
export type {
  // Config types
  ServerConfig,
  ManagerConfig,
  LifecycleConfig,
  StdioServerConfig,
  HttpServerConfig,
  ServerConnectionConfig,
} from './types/config.js';

export {
  DEFAULT_LIFECYCLE_CONFIG,
  resolveLifecycleConfig,
} from './types/config.js';

export type {
  // State types
  ServerStatus,
  ServerState,
  ServerStateSummary,
  HealthCheckResult,
  RestartStats,
} from './types/state.js';

export {
  createInitialState,
  toStateSummary,
} from './types/state.js';

export type {
  // Event types
  LifecycleEvent,
  LifecycleEventType,
  LifecycleEventMap,
  LifecycleEventHandler,
  AnyLifecycleEventHandler,
  BaseServerEvent,
  ServerStatusChangedEvent,
  ServerHealthyEvent,
  ServerUnhealthyEvent,
  ServerCrashedEvent,
  ServerRestartingEvent,
  ServerRestartSucceededEvent,
  ServerRestartFailedEvent,
  ServerStoppedEvent,
  ServerConnectingEvent,
  ServerConnectedEvent,
  ServerConnectionFailedEvent,
  ManagerEvent,
  ManagerEventType,
  ManagerEventMap,
  ManagerReadyEvent,
  ManagerShutdownEvent,
  ManagerStateSnapshotEvent,
} from './types/events.js';

// Manager
export {
  ServerManager,
  type ServerManagerOptions,
  type AllEventMap,
  type AllEventType,
} from './manager/server-manager.js';

export {
  ConfigLoader,
  createServerConfig,
  createStdioConfig,
  createHttpConfig,
  type ValidationResult,
  type ValidationError,
} from './manager/config-loader.js';

// Core components (for advanced usage)
export { ServerLifecycle } from './core/server-lifecycle.js';
export { HealthMonitor, type HealthMonitorConfig, type HealthMonitorCallbacks } from './core/health-monitor.js';
export { ProcessManager, type ProcessManagerEvents } from './core/process-manager.js';
export { HttpConnection, type HttpTransportConfig, createFetchOptions } from './core/http-connection.js';

// Utilities
export {
  // Logger
  type Logger,
  type LogLevel,
  type LoggerFactory,
  ConsoleLogger,
  ConsoleLoggerFactory,
  NoopLogger,
  NoopLoggerFactory,
  setDefaultLoggerFactory,
  getDefaultLoggerFactory,
  createLogger,
} from './utils/logger.js';

export {
  // Retry utilities
  calculateBackoff,
  delay,
  cancellableDelay,
  retry,
  withTimeout,
  createDeferred,
  type BackoffConfig,
  type RetryConfig,
  type RetryResult,
  type Deferred,
  DEFAULT_BACKOFF_CONFIG,
} from './utils/retry.js';
