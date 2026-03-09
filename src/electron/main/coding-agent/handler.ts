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

// NOTE: Module-level singleton — assumes a single BrowserWindow.
// If multi-window support is added, this should become a Map<BrowserWindow, CodingAgentAdapter>.
let adapter: CodingAgentAdapter | null = null;
let starting = false;

export function registerCodingAgentHandlers(win: BrowserWindow): void {
  ipcMain.handle(AGENT_START, async (_event, config: CodingAgentConfig) => {
    // Guard against concurrent start() calls — ipcMain.handle does NOT
    // serialize async handlers, so two calls can interleave at await points.
    if (starting) return;
    starting = true;
    try {
      // Reuse existing adapter if its process is alive and idle
      if (adapter && adapter.isProcessAlive() && !adapter.isRunning()) {
        return;
      }
      // Stop any existing adapter before starting a new one
      if (adapter) {
        await adapter.stop();
      }
      adapter = createPiAdapter();
      // Default cwd to main process working directory (renderer can't access process.cwd)
      await adapter.start({ ...config, cwd: config.cwd || process.cwd() });
    } finally {
      starting = false;
    }
  });

  ipcMain.handle(AGENT_EXECUTE, async (_event, task: string) => {
    if (!adapter) throw new Error('Coding agent not started');
    if (adapter.isRunning()) throw new Error('Agent is already executing a task');

    try {
      for await (const event of adapter.execute(task)) {
        if (!win.isDestroyed()) {
          win.webContents.send(AGENT_EVENT, event);
        }
      }
    } catch (err) {
      // Send terminal error event so the UI can clean up state.
      // Don't re-throw — the error event is the canonical error path,
      // re-throwing would cause a duplicate AGENT_RUN_ERROR dispatch.
      if (!win.isDestroyed()) {
        win.webContents.send(AGENT_EVENT, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
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

/** Remove all coding agent IPC handlers (call from app before-quit) */
export function unregisterCodingAgentHandlers(): void {
  ipcMain.removeHandler(AGENT_START);
  ipcMain.removeHandler(AGENT_EXECUTE);
  ipcMain.removeHandler(AGENT_STEER);
  ipcMain.removeHandler(AGENT_ABORT);
  ipcMain.removeHandler(AGENT_STOP);
  ipcMain.removeHandler(AGENT_UI_RESPONSE);
}

/** Gracefully stop the coding agent (call from app before-quit) */
export async function shutdownCodingAgent(): Promise<void> {
  if (adapter) {
    await adapter.stop();
    adapter = null;
  }
}
