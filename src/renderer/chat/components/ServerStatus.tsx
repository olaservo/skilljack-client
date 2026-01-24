/**
 * Server Status Component
 *
 * Displays connected MCP servers with lifecycle status indicators.
 * Supports full lifecycle states: connected, connecting, disconnected,
 * unhealthy, restarting, failed, stopped.
 */

import * as Tooltip from '@radix-ui/react-tooltip';
import type { ServerInfo, ServerStatus as ServerStatusType } from '../types';

interface ServerStatusProps {
  servers: ServerInfo[];
}

/**
 * Get human-readable status label
 */
function getStatusLabel(status: ServerStatusType): string {
  const labels: Record<ServerStatusType, string> = {
    connected: 'Connected',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
    unhealthy: 'Unhealthy',
    restarting: 'Restarting...',
    failed: 'Failed',
    stopped: 'Stopped',
  };
  return labels[status] || status;
}

/**
 * Build tooltip details based on server state
 */
function getTooltipDetails(server: ServerInfo): React.ReactNode[] {
  const details: React.ReactNode[] = [];

  // Version
  if (server.version) {
    details.push(
      <div key="version" className="tooltip-detail">
        Version: {server.version}
      </div>
    );
  }

  // Tool count
  details.push(
    <div key="tools" className="tooltip-detail">
      Tools: {server.toolCount}
    </div>
  );

  // Status with label
  details.push(
    <div key="status" className="tooltip-detail">
      Status: {getStatusLabel(server.status)}
    </div>
  );

  // Restart attempts (when restarting)
  if (server.status === 'restarting' && server.restartAttempts !== undefined) {
    const maxAttempts = server.maxRestartAttempts ?? 5;
    details.push(
      <div key="restart" className="tooltip-detail">
        Restart attempt: {server.restartAttempts}/{maxAttempts}
      </div>
    );
  }

  // Health check failures (when unhealthy)
  if (server.status === 'unhealthy' && server.healthChecksFailed !== undefined) {
    details.push(
      <div key="health" className="tooltip-detail">
        Health checks failed: {server.healthChecksFailed}
      </div>
    );
  }

  // Last error (when failed or unhealthy)
  if ((server.status === 'failed' || server.status === 'unhealthy') && server.lastError) {
    details.push(
      <div key="error" className="tooltip-detail tooltip-error">
        Error: {server.lastError}
      </div>
    );
  }

  return details;
}

export function ServerStatus({ servers }: ServerStatusProps) {
  if (servers.length === 0) {
    return (
      <div className="server-status">
        <span className="server-badge" data-status="connecting">
          <span className="server-badge-indicator" data-status="connecting" />
          <span>Connecting...</span>
        </span>
      </div>
    );
  }

  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="server-status">
        {servers.map((server) => (
          <Tooltip.Root key={server.name}>
            <Tooltip.Trigger asChild>
              <span className="server-badge" data-status={server.status}>
                <span
                  className="server-badge-indicator"
                  data-status={server.status}
                />
                <span>{server.name}</span>
              </span>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip-content" sideOffset={5}>
                <div className="tooltip-title">{server.name}</div>
                {getTooltipDetails(server)}
                <Tooltip.Arrow className="tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </div>
    </Tooltip.Provider>
  );
}
