/**
 * Config Adapter
 *
 * Converts legacy MultiServerConfig format to the new ManagerConfig format
 * expected by @skilljack/mcp-server-manager.
 */

import type {
  ManagerConfig,
  ServerConfig,
  StdioServerConfig as NewStdioConfig,
  HttpServerConfig as NewHttpConfig,
} from '@skilljack/mcp-server-manager';
import type {
  MultiServerConfig,
  StdioServerConfig as LegacyStdioConfig,
  HttpServerConfig as LegacyHttpConfig,
  ServerConnectionConfig as LegacyConnectionConfig,
} from '../../multi-server.js';

/**
 * Convert a legacy server connection config to the new format
 */
function convertConnection(legacy: LegacyConnectionConfig): NewStdioConfig | NewHttpConfig {
  if (legacy.transport === 'stdio') {
    const stdio = legacy as LegacyStdioConfig;
    return {
      type: 'stdio',
      command: stdio.command,
      args: stdio.args,
      env: stdio.env,
      cwd: stdio.cwd,
    };
  } else {
    const http = legacy as LegacyHttpConfig;
    return {
      type: 'http',
      url: http.url,
      headers: http.headers,
    };
  }
}

/**
 * Convert legacy MultiServerConfig to ManagerConfig
 *
 * @param legacy - Legacy config format with mcpServers object
 * @returns ManagerConfig for mcp-server-manager
 */
export function convertLegacyConfig(legacy: MultiServerConfig): ManagerConfig {
  const servers: ServerConfig[] = Object.entries(legacy.mcpServers).map(
    ([name, connectionConfig]): ServerConfig => ({
      name,
      connection: convertConnection(connectionConfig),
      autoStart: true,
    })
  );

  return {
    servers,
    defaults: {
      healthCheckEnabled: true,
      healthCheckIntervalMs: 30000,
      healthCheckTimeoutMs: 5000,
      unhealthyThreshold: 3,
      autoRestartEnabled: true,
      maxRestartAttempts: 5,
      restartBackoffBaseMs: 1000,
      restartBackoffMaxMs: 30000,
      shutdownTimeoutMs: 10000,
    },
  };
}
