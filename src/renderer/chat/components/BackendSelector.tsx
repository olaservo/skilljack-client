/**
 * Backend Selector Component
 *
 * Dropdown in the chat drawer header to pick what drives the conversation:
 * the built-in AI SDK models (Doer / Dreamer) or an external ACP agent.
 * When an ACP backend is active it also shows the session's working
 * directory as a clickable chip.
 */

import { useCallback, useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { useCommunication } from '../../hooks/useCommunication';
import type { AcpAgentInfo } from '../../../shared/acp-types';

export function BackendSelector() {
  const { state, setBackend, newSession } = useChat();
  const adapter = useCommunication();
  const [agents, setAgents] = useState<AcpAgentInfo[]>([]);

  const refreshAgents = useCallback(async () => {
    if (!adapter.acp) return;
    try {
      setAgents(await adapter.acp.getAgents());
    } catch (err) {
      console.error('[BackendSelector] Failed to load agents:', err);
    }
  }, [adapter]);

  useEffect(() => {
    if (!adapter.acp) return;
    refreshAgents();
    return adapter.acp.onAgentStatusChanged(() => {
      refreshAgents();
    });
  }, [adapter, refreshAgents]);

  // ACP is Electron-only; hide the selector entirely in web mode
  if (!adapter.acp) {
    return null;
  }

  const enabledAgents = agents.filter((agent) => agent.enabled);
  const value =
    state.backend.kind === 'ai-sdk'
      ? `ai-sdk:${state.backend.role}`
      : `acp:${state.backend.agentId}`;

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (next === value) return;
    if (next.startsWith('ai-sdk:')) {
      setBackend({ kind: 'ai-sdk', role: next.slice(7) as 'doer' | 'dreamer' });
    } else if (next.startsWith('acp:')) {
      const agentId = next.slice(4);
      const agent = agents.find((a) => a.id === agentId);
      setBackend({ kind: 'acp', agentId, agentName: agent?.displayName ?? agentId });
    }
  };

  const activeAgent =
    state.backend.kind === 'acp'
      ? agents.find((a) => a.id === (state.backend as { agentId: string }).agentId)
      : undefined;
  const cwd = state.acpSession?.cwd ?? activeAgent?.defaultSessionCwd ?? null;

  const handlePickCwd = async () => {
    if (!adapter.acp || state.backend.kind !== 'acp') return;
    const picked = await adapter.acp.pickDirectory();
    if (!picked) return;
    await adapter.acp.updateAgent(state.backend.agentId, { defaultSessionCwd: picked });
    await refreshAgents();
    // A new cwd means a new agent session
    newSession();
  };

  return (
    <div className="backend-selector">
      <select
        className="backend-selector-select"
        value={value}
        onChange={handleChange}
        disabled={state.isProcessing}
        aria-label="Chat backend"
        title="Choose what drives the conversation"
      >
        <optgroup label="Models">
          <option value="ai-sdk:doer">Doer</option>
          <option value="ai-sdk:dreamer">Dreamer</option>
        </optgroup>
        {enabledAgents.length > 0 && (
          <optgroup label="Agents (ACP)">
            {enabledAgents.map((agent) => (
              <option key={agent.id} value={`acp:${agent.id}`}>
                {agent.displayName}
                {agent.status === 'running' ? ' ●' : agent.status === 'crashed' ? ' ✕' : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {state.backend.kind === 'acp' && (
        <button
          className="backend-cwd-chip"
          onClick={handlePickCwd}
          disabled={state.isProcessing}
          title={cwd ? `Working directory: ${cwd}\nClick to change (starts a new session)` : 'Pick a working directory'}
        >
          {cwd ? shortenPath(cwd) : 'Pick folder…'}
        </button>
      )}
    </div>
  );
}

function shortenPath(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return fullPath;
  return `…${fullPath.includes('\\') ? '\\' : '/'}${parts.slice(-2).join(fullPath.includes('\\') ? '\\' : '/')}`;
}
