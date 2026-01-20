/**
 * Event types for MCP server lifecycle management
 */

import type { ServerStatus, HealthCheckResult, ServerStateSummary } from './state.js';

/**
 * Base event interface with common properties
 */
export interface BaseServerEvent {
  /** Server name that triggered the event */
  serverName: string;
  /** Timestamp of the event */
  timestamp: Date;
}

/**
 * Event emitted when a server's status changes
 */
export interface ServerStatusChangedEvent extends BaseServerEvent {
  type: 'server:status-changed';
  /** Previous status */
  previousStatus: ServerStatus;
  /** New status */
  newStatus: ServerStatus;
}

/**
 * Event emitted when a server becomes healthy
 */
export interface ServerHealthyEvent extends BaseServerEvent {
  type: 'server:healthy';
  /** Health check result that confirmed health */
  healthCheck: HealthCheckResult;
}

/**
 * Event emitted when a server becomes unhealthy
 */
export interface ServerUnhealthyEvent extends BaseServerEvent {
  type: 'server:unhealthy';
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Last health check result */
  lastHealthCheck: HealthCheckResult;
}

/**
 * Event emitted when a server process crashes
 */
export interface ServerCrashedEvent extends BaseServerEvent {
  type: 'server:crashed';
  /** Exit code of the process */
  exitCode: number | null;
  /** Signal that killed the process */
  signal: string | null;
  /** Whether auto-restart will be attempted */
  willRestart: boolean;
}

/**
 * Event emitted when a server restart is initiated
 */
export interface ServerRestartingEvent extends BaseServerEvent {
  type: 'server:restarting';
  /** Current attempt number */
  attempt: number;
  /** Maximum attempts allowed */
  maxAttempts: number;
  /** Reason for the restart */
  reason: 'crashed' | 'unhealthy' | 'manual';
}

/**
 * Event emitted when a server restart succeeds
 */
export interface ServerRestartSucceededEvent extends BaseServerEvent {
  type: 'server:restart-succeeded';
  /** Number of attempts it took */
  attempts: number;
  /** New process ID */
  pid?: number;
}

/**
 * Event emitted when a server restart fails
 */
export interface ServerRestartFailedEvent extends BaseServerEvent {
  type: 'server:restart-failed';
  /** Number of attempts made */
  attempts: number;
  /** Error message */
  error: string;
}

/**
 * Event emitted when a server is stopped
 */
export interface ServerStoppedEvent extends BaseServerEvent {
  type: 'server:stopped';
  /** Whether shutdown was graceful */
  graceful: boolean;
}

/**
 * Event emitted when a server starts connecting
 */
export interface ServerConnectingEvent extends BaseServerEvent {
  type: 'server:connecting';
}

/**
 * Event emitted when a server successfully connects
 */
export interface ServerConnectedEvent extends BaseServerEvent {
  type: 'server:connected';
  /** Process ID for stdio servers */
  pid?: number;
}

/**
 * Event emitted when a server fails to connect
 */
export interface ServerConnectionFailedEvent extends BaseServerEvent {
  type: 'server:connection-failed';
  /** Error message */
  error: string;
}

/**
 * Union type of all lifecycle events
 */
export type LifecycleEvent =
  | ServerStatusChangedEvent
  | ServerHealthyEvent
  | ServerUnhealthyEvent
  | ServerCrashedEvent
  | ServerRestartingEvent
  | ServerRestartSucceededEvent
  | ServerRestartFailedEvent
  | ServerStoppedEvent
  | ServerConnectingEvent
  | ServerConnectedEvent
  | ServerConnectionFailedEvent;

/**
 * Event type discriminator
 */
export type LifecycleEventType = LifecycleEvent['type'];

/**
 * Map of event types to their event interfaces
 */
export interface LifecycleEventMap {
  'server:status-changed': ServerStatusChangedEvent;
  'server:healthy': ServerHealthyEvent;
  'server:unhealthy': ServerUnhealthyEvent;
  'server:crashed': ServerCrashedEvent;
  'server:restarting': ServerRestartingEvent;
  'server:restart-succeeded': ServerRestartSucceededEvent;
  'server:restart-failed': ServerRestartFailedEvent;
  'server:stopped': ServerStoppedEvent;
  'server:connecting': ServerConnectingEvent;
  'server:connected': ServerConnectedEvent;
  'server:connection-failed': ServerConnectionFailedEvent;
}

/**
 * Event handler type for lifecycle events
 */
export type LifecycleEventHandler<T extends LifecycleEventType> = (
  event: LifecycleEventMap[T]
) => void;

/**
 * Generic event handler for any lifecycle event
 */
export type AnyLifecycleEventHandler = (event: LifecycleEvent) => void;

/**
 * Manager-level events
 */
export interface ManagerReadyEvent {
  type: 'manager:ready';
  timestamp: Date;
  serverCount: number;
}

export interface ManagerShutdownEvent {
  type: 'manager:shutdown';
  timestamp: Date;
  graceful: boolean;
}

export interface ManagerStateSnapshotEvent {
  type: 'manager:state-snapshot';
  timestamp: Date;
  servers: ServerStateSummary[];
}

export type ManagerEvent =
  | ManagerReadyEvent
  | ManagerShutdownEvent
  | ManagerStateSnapshotEvent;

export type ManagerEventType = ManagerEvent['type'];

export interface ManagerEventMap {
  'manager:ready': ManagerReadyEvent;
  'manager:shutdown': ManagerShutdownEvent;
  'manager:state-snapshot': ManagerStateSnapshotEvent;
}

export type ManagerEventHandler<T extends ManagerEventType> = (
  event: ManagerEventMap[T]
) => void;
