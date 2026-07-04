/**
 * Agents Settings Section
 *
 * Manage ACP agents: enable/disable, edit launch command, add custom
 * agents, stop running agent processes. Electron-only (hidden when the
 * adapter has no ACP support).
 */

import { useCallback, useEffect, useState } from 'react';
import { useCommunication } from '../hooks/useCommunication';
import type { AcpAgentInfo } from '../../shared/acp-types';

const STATUS_LABEL: Record<AcpAgentInfo['status'], string> = {
  idle: 'Idle',
  starting: 'Starting…',
  running: 'Running',
  crashed: 'Crashed',
};

interface AgentEditState {
  command: string;
  args: string;
  env: string;
}

function toEditState(agent: AcpAgentInfo): AgentEditState {
  return {
    command: agent.command,
    args: (agent.args ?? []).join(' '),
    env: Object.entries(agent.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  };
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
  return env;
}

/** Split a command-line string into args, respecting double quotes */
function parseArgs(text: string): string[] {
  const matches = text.match(/"[^"]*"|\S+/g) ?? [];
  return matches.map((arg) => (arg.startsWith('"') && arg.endsWith('"') ? arg.slice(1, -1) : arg));
}

export function AgentsSection() {
  const adapter = useCommunication();
  const [agents, setAgents] = useState<AcpAgentInfo[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<AgentEditState>({ command: '', args: '', env: '' });
  const [newAgentName, setNewAgentName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!adapter.acp) return;
    try {
      setAgents(await adapter.acp.getAgents());
    } catch (err) {
      console.error('[AgentsSection] Failed to load agents:', err);
    }
  }, [adapter]);

  useEffect(() => {
    if (!adapter.acp) return;
    refresh();
    return adapter.acp.onAgentStatusChanged(() => refresh());
  }, [adapter, refresh]);

  if (!adapter.acp) return null;
  const acp = adapter.acp;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveEdit = (agent: AcpAgentInfo) =>
    run(async () => {
      await acp.updateAgent(agent.id, {
        command: edit.command.trim(),
        args: parseArgs(edit.args),
        env: parseEnv(edit.env),
      });
      setEditingId(null);
    });

  const addAgent = () =>
    run(async () => {
      const name = newAgentName.trim();
      if (!name) throw new Error('Agent name is required');
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await acp.addAgent(id, {
        displayName: name,
        command: '',
        args: [],
        env: {},
        enabled: true,
      });
      setNewAgentName('');
      setEditingId(id);
      setEdit({ command: '', args: '', env: '' });
    });

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3 className="settings-section-title">Agents (ACP)</h3>
        <p className="settings-section-description">
          External coding agents driven over the Agent Client Protocol
        </p>
      </div>

      {error && <div className="settings-agents-error">{error}</div>}

      <div className="settings-agents-list">
        {agents.map((agent) => (
          <div key={agent.id} className="settings-agent-row">
            <div className="settings-agent-main">
              <label className="settings-agent-toggle">
                <input
                  type="checkbox"
                  checked={agent.enabled}
                  onChange={(e) => run(() => acp.updateAgent(agent.id, { enabled: e.target.checked }))}
                />
                <span className="settings-agent-name">{agent.displayName}</span>
              </label>
              <span className="settings-agent-status" data-status={agent.status}>
                {STATUS_LABEL[agent.status]}
              </span>
              <span className="settings-agent-actions">
                <button
                  className="settings-agent-button"
                  onClick={() => {
                    if (editingId === agent.id) {
                      setEditingId(null);
                    } else {
                      setEditingId(agent.id);
                      setEdit(toEditState(agent));
                    }
                  }}
                >
                  {editingId === agent.id ? 'Cancel' : 'Edit'}
                </button>
                {(agent.status === 'running' || agent.status === 'starting') && (
                  <button
                    className="settings-agent-button"
                    onClick={() => run(() => acp.stopAgent(agent.id))}
                  >
                    Stop
                  </button>
                )}
                {!agent.builtIn && (
                  <button
                    className="settings-agent-button settings-agent-remove"
                    onClick={() => run(() => acp.removeAgent(agent.id))}
                  >
                    Remove
                  </button>
                )}
              </span>
            </div>

            <div className="settings-agent-command" title={`${agent.command} ${(agent.args ?? []).join(' ')}`}>
              {agent.command} {(agent.args ?? []).join(' ')}
            </div>

            {editingId === agent.id && (
              <div className="settings-agent-edit">
                <label className="settings-label">Command</label>
                <input
                  className="settings-input"
                  value={edit.command}
                  onChange={(e) => setEdit({ ...edit, command: e.target.value })}
                  placeholder="npx"
                />
                <label className="settings-label">Arguments</label>
                <input
                  className="settings-input"
                  value={edit.args}
                  onChange={(e) => setEdit({ ...edit, args: e.target.value })}
                  placeholder="-y @agentclientprotocol/claude-agent-acp"
                />
                <label className="settings-label">Environment (KEY=value per line)</label>
                <textarea
                  className="settings-input settings-agent-env"
                  value={edit.env}
                  onChange={(e) => setEdit({ ...edit, env: e.target.value })}
                  placeholder="ANTHROPIC_API_KEY=…"
                  rows={2}
                />
                <button className="settings-agent-button" onClick={() => saveEdit(agent)}>
                  Save
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="settings-agent-add">
        <input
          className="settings-input"
          value={newAgentName}
          onChange={(e) => setNewAgentName(e.target.value)}
          placeholder="New agent name…"
        />
        <button className="settings-agent-button" onClick={addAgent} disabled={!newAgentName.trim()}>
          Add agent
        </button>
      </div>
    </div>
  );
}
