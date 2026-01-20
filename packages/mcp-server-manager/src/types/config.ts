/**
 * Configuration types for MCP server connections and lifecycle management
 */

/**
 * Configuration for stdio-based server connections
 */
export interface StdioServerConfig {
  type: 'stdio';
  /** Command to execute */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables to pass to the process */
  env?: Record<string, string>;
  /** Working directory for the process */
  cwd?: string;
}

/**
 * Configuration for HTTP-based server connections
 */
export interface HttpServerConfig {
  type: 'http';
  /** Base URL for the HTTP server */
  url: string;
  /** HTTP headers to include with requests */
  headers?: Record<string, string>;
}

/**
 * Union type for server connection configurations
 */
export type ServerConnectionConfig = StdioServerConfig | HttpServerConfig;

/**
 * Lifecycle configuration options for a server
 */
export interface LifecycleConfig {
  /** Enable periodic health checks (default: true) */
  healthCheckEnabled?: boolean;
  /** Interval between health checks in milliseconds (default: 30000) */
  healthCheckIntervalMs?: number;
  /** Timeout for individual health check in milliseconds (default: 5000) */
  healthCheckTimeoutMs?: number;
  /** Number of consecutive failures before marking unhealthy (default: 3) */
  unhealthyThreshold?: number;
  /** Enable automatic restart on failure (default: true) */
  autoRestartEnabled?: boolean;
  /** Maximum number of restart attempts before giving up (default: 5) */
  maxRestartAttempts?: number;
  /** Base delay for exponential backoff in milliseconds (default: 1000) */
  restartBackoffBaseMs?: number;
  /** Maximum backoff delay in milliseconds (default: 30000) */
  restartBackoffMaxMs?: number;
  /** Timeout for graceful shutdown in milliseconds (default: 10000) */
  shutdownTimeoutMs?: number;
}

/**
 * Complete configuration for a single MCP server
 */
export interface ServerConfig {
  /** Unique identifier for the server */
  name: string;
  /** Connection configuration (stdio or HTTP) */
  connection: ServerConnectionConfig;
  /** Optional lifecycle configuration (defaults applied if not specified) */
  lifecycle?: LifecycleConfig;
  /** Whether this server should auto-start with the manager (default: true) */
  autoStart?: boolean;
}

/**
 * Configuration for the server manager
 */
export interface ManagerConfig {
  /** List of server configurations */
  servers: ServerConfig[];
  /** Global defaults for lifecycle settings (overridden by per-server settings) */
  defaults?: LifecycleConfig;
}

/**
 * Default values for lifecycle configuration
 */
export const DEFAULT_LIFECYCLE_CONFIG: Required<LifecycleConfig> = {
  healthCheckEnabled: true,
  healthCheckIntervalMs: 30000,
  healthCheckTimeoutMs: 5000,
  unhealthyThreshold: 3,
  autoRestartEnabled: true,
  maxRestartAttempts: 5,
  restartBackoffBaseMs: 1000,
  restartBackoffMaxMs: 30000,
  shutdownTimeoutMs: 10000,
};

/**
 * Merges lifecycle configurations with defaults
 */
export function resolveLifecycleConfig(
  serverConfig?: LifecycleConfig,
  globalDefaults?: LifecycleConfig
): Required<LifecycleConfig> {
  return {
    ...DEFAULT_LIFECYCLE_CONFIG,
    ...globalDefaults,
    ...serverConfig,
  };
}
