/**
 * Coding Agent IPC Handlers
 *
 * Registers IPC handlers for the coding agent lifecycle.
 * Streams agent events to the renderer via the AGENT_EVENT channel.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import { createPiAdapter } from './pi-adapter.js';
import type { CodingAgentAdapter, CodingAgentConfig, ExtensionUIResponse } from './adapter.js';
import {
  AGENT_START,
  AGENT_EXECUTE,
  AGENT_STEER,
  AGENT_ABORT,
  AGENT_STOP,
  AGENT_UI_RESPONSE,
  AGENT_EVENT,
} from '../../../shared/channels.js';

let adapter: CodingAgentAdapter | null = null;

export function registerCodingAgentHandlers(win: BrowserWindow): void {
  ipcMain.handle(AGENT_START, async (_event, config: CodingAgentConfig) => {
    // Stop any existing adapter before starting a new one
    if (adapter) {
      await adapter.stop();
    }
    adapter = createPiAdapter();
    await adapter.start(config);
  });

  ipcMain.handle(AGENT_EXECUTE, async (_event, task: string) => {
    if (!adapter) throw new Error('Coding agent not started');

    for await (const event of adapter.execute(task)) {
      if (!win.isDestroyed()) {
        win.webContents.send(AGENT_EVENT, event);
      }
    }
  });

  ipcMain.handle(AGENT_STEER, async (_event, message: string) => {
    if (!adapter) throw new Error('Coding agent not started');
    await adapter.steer(message);
  });

  ipcMain.handle(AGENT_ABORT, async () => {
    if (!adapter) throw new Error('Coding agent not started');
    await adapter.abort();
  });

  ipcMain.handle(AGENT_STOP, async () => {
    if (adapter) {
      await adapter.stop();
      adapter = null;
    }
  });

  ipcMain.handle(AGENT_UI_RESPONSE, async (_event, response: ExtensionUIResponse) => {
    if (!adapter) throw new Error('Coding agent not started');
    await adapter.respondToUIRequest(response);
  });
}

/** Gracefully stop the coding agent (call from app before-quit) */
export async function shutdownCodingAgent(): Promise<void> {
  if (adapter) {
    await adapter.stop();
    adapter = null;
  }
}
