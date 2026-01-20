/**
 * State types for MCP server lifecycle management
 */

/**
 * Possible states for a managed server
 *
 * State transitions:
 * - disconnected → connecting (on start)
 * - connecting → connected (on successful connection)
 * - connecting → failed (on connection error, max retries exceeded)
 * - connected → unhealthy (on health check failures)
 * - connected → disconnected (on graceful stop)
 * - unhealthy → connected (on health check recovery)
 * - unhealthy → restarting (on auto-restart trigger)
 * - restarting → connecting (restart initiated)
 * - restarting → failed (max restart attempts exceeded)
 * - any → stopped (on manual stop)
 */
export type ServerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'unhealthy'
  | 'restarting'
  | 'failed'
  | 'stopped';

/**
 * Result of a health check operation
 */
export interface HealthCheckResult {
  /** Whether the health check succeeded */
  healthy: boolean;
  /** Time taken for the health check in milliseconds */
  latencyMs: number;
  /** Error message if the check failed */
  error?: string;
  /** Timestamp of the health check */
  timestamp: Date;
}

/**
 * Statistics for restart attempts
 */
export interface RestartStats {
  /** Number of restart attempts made */
  attempts: number;
  /** Timestamp of the last restart attempt */
  lastAttempt?: Date;
  /** Whether the last restart attempt succeeded */
  lastSuccess?: boolean;
}

/**
 * Complete state for a managed server
 */
export interface ServerState {
  /** Current status of the server */
  status: ServerStatus;
  /** Timestamp when server entered current status */
  statusChangedAt: Date;
  /** Number of consecutive failed health checks */
  consecutiveHealthCheckFailures: number;
  /** Last health check result */
  lastHealthCheck?: HealthCheckResult;
  /** Restart statistics */
  restartStats: RestartStats;
  /** Process ID for stdio servers */
  pid?: number;
  /** Error message if in failed state */
  error?: string;
}

/**
 * Creates an initial server state
 */
export function createInitialState(): ServerState {
  return {
    status: 'disconnected',
    statusChangedAt: new Date(),
    consecutiveHealthCheckFailures: 0,
    restartStats: {
      attempts: 0,
    },
  };
}

/**
 * Summary state for external consumers
 */
export interface ServerStateSummary {
  /** Server name */
  name: string;
  /** Current status */
  status: ServerStatus;
  /** Whether the server is healthy */
  healthy: boolean;
  /** Time in current status (milliseconds) */
  timeInStatus: number;
  /** Process ID if applicable */
  pid?: number;
  /** Last health check latency if available */
  lastLatencyMs?: number;
  /** Restart attempt count */
  restartAttempts: number;
  /** Error message if any */
  error?: string;
}

/**
 * Converts full state to summary
 */
export function toStateSummary(name: string, state: ServerState): ServerStateSummary {
  return {
    name,
    status: state.status,
    healthy: state.status === 'connected',
    timeInStatus: Date.now() - state.statusChangedAt.getTime(),
    pid: state.pid,
    lastLatencyMs: state.lastHealthCheck?.latencyMs,
    restartAttempts: state.restartStats.attempts,
    error: state.error,
  };
}
