/**
 * Server Status Component
 *
 * Displays connected MCP servers with status indicators.
 */

import * as Tooltip from '@radix-ui/react-tooltip';
import type { ServerInfo } from '../types';

interface ServerStatusProps {
  servers: ServerInfo[];
}

export function ServerStatus({ servers }: ServerStatusProps) {
  if (servers.length === 0) {
    return (
      <div className="server-status">
        <span className="server-badge">
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
              <span className="server-badge">
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
                {server.version && (
                  <div className="tooltip-detail">Version: {server.version}</div>
                )}
                <div className="tooltip-detail">
                  Tools: {server.toolCount}
                </div>
                <div className="tooltip-detail">
                  Status: {server.status}
                </div>
                <Tooltip.Arrow className="tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </div>
    </Tooltip.Provider>
  );
}
