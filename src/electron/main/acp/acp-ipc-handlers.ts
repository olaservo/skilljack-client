/**
 * ACP IPC Handlers
 *
 * Registers all acp:* invoke channels; delegates to AcpManager.
 */

import { ipcMain } from 'electron';
import log from 'electron-log';
import * as channels from '../../../shared/channels.js';
import type {
  AcpAgentConfig,
  AcpPermissionOutcome,
} from '../../../shared/acp-types.js';
import type { AcpManager } from './acp-manager.js';

export function setupAcpIpcHandlers(acpManager: AcpManager): void {
  ipcMain.handle(channels.ACP_GET_AGENTS, () => {
    return { agents: acpManager.getAgents() };
  });

  ipcMain.handle(channels.ACP_ADD_AGENT, (_event, id: string, config: AcpAgentConfig) => {
    acpManager.addAgent(id, config);
    return { success: true };
  });

  ipcMain.handle(
    channels.ACP_UPDATE_AGENT,
    (_event, id: string, updates: Partial<AcpAgentConfig>) => {
      acpManager.updateAgent(id, updates);
      return { success: true };
    }
  );

  ipcMain.handle(channels.ACP_REMOVE_AGENT, (_event, id: string) => {
    acpManager.removeAgent(id);
    return { success: true };
  });

  ipcMain.handle(channels.ACP_STOP_AGENT, (_event, id: string) => {
    acpManager.stopAgent(id);
    return { success: true };
  });

  ipcMain.handle(channels.ACP_NEW_SESSION, async (_event, agentId: string, cwd: string) => {
    log.info(`[ACP] New session requested: agent=${agentId}, cwd=${cwd}`);
    return acpManager.newSession(agentId, cwd);
  });

  ipcMain.handle(channels.ACP_PROMPT, (_event, sessionId: string, text: string) => {
    return { turnId: acpManager.prompt(sessionId, text) };
  });

  ipcMain.handle(channels.ACP_CANCEL, async (_event, sessionId: string) => {
    await acpManager.cancel(sessionId);
    return { success: true };
  });

  ipcMain.handle(channels.ACP_SET_MODE, async (_event, sessionId: string, modeId: string) => {
    await acpManager.setMode(sessionId, modeId);
    return { success: true };
  });

  ipcMain.handle(
    channels.ACP_SET_CONFIG_OPTION,
    async (_event, sessionId: string, configId: string, value: string | boolean) => {
      await acpManager.setConfigOption(sessionId, configId, value);
      return { success: true };
    }
  );

  ipcMain.handle(
    channels.ACP_RESPOND_PERMISSION,
    (_event, requestId: string, outcome: AcpPermissionOutcome) => {
      acpManager.respondPermission(requestId, outcome);
      return { success: true };
    }
  );

  ipcMain.handle(
    channels.ACP_GET_TERMINAL_OUTPUT,
    (_event, sessionId: string, terminalId: string) => {
      return acpManager.getTerminalOutput(sessionId, terminalId);
    }
  );
}

export function cleanupAcpIpcHandlers(): void {
  const handled = [
    channels.ACP_GET_AGENTS,
    channels.ACP_ADD_AGENT,
    channels.ACP_UPDATE_AGENT,
    channels.ACP_REMOVE_AGENT,
    channels.ACP_STOP_AGENT,
    channels.ACP_NEW_SESSION,
    channels.ACP_PROMPT,
    channels.ACP_CANCEL,
    channels.ACP_SET_MODE,
    channels.ACP_SET_CONFIG_OPTION,
    channels.ACP_RESPOND_PERMISSION,
    channels.ACP_GET_TERMINAL_OUTPUT,
  ];
  for (const channel of handled) {
    ipcMain.removeHandler(channel);
  }
}
