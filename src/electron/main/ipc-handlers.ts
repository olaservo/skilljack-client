/**
 * Electron IPC Handlers
 *
 * Registers IPC handlers for communication between renderer and main process.
 * All handlers use the channel constants from shared/channels.ts.
 */

import { ipcMain, BrowserWindow } from 'electron';
import log from 'electron-log';
import Store from 'electron-store';
import type { ModelMessage } from 'ai';
import * as channels from '../../shared/channels.js';
import { streamChat, mergeSettings } from '../../web/llm/provider.js';
import { buildSystemPrompt } from '../../web/llm/system-prompt.js';
import type { McpManager } from './mcp-manager.js';
import type { ChatRequest, StreamEvent, McpContext } from '../../shared/types.js';

// Settings store for renderer preferences
const settingsStore = new Store({
  name: 'settings',
  defaults: {
    doer: {
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTurns: 10,
    },
    dreamer: {
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTurns: 10,
    },
  },
});

// Track active chat streams
const activeStreams = new Map<string, AbortController>();
let streamIdCounter = 0;

let registeredWindow: BrowserWindow | null = null;
let registeredServerManager: McpManager | null = null;

export function setupIPCHandlers(
  mainWindow: BrowserWindow,
  serverManager: McpManager
): void {
  registeredWindow = mainWindow;
  registeredServerManager = serverManager;
  serverManager.setMainWindow(mainWindow);

  // ============================================
  // Server Management
  // ============================================

  ipcMain.handle(channels.GET_SERVERS, async () => {
    try {
      const servers = await serverManager.getServers();
      return { servers };
    } catch (error) {
      log.error('GET_SERVERS error:', error);
      throw error;
    }
  });

  ipcMain.handle(channels.GET_CONFIG, () => {
    return serverManager.getConfig();
  });

  // ============================================
  // Tools
  // ============================================

  ipcMain.handle(channels.GET_TOOLS, async (_event, options?: { hasUi?: boolean }) => {
    try {
      const tools = await serverManager.getTools(options);
      return { tools };
    } catch (error) {
      log.error('GET_TOOLS error:', error);
      throw error;
    }
  });

  ipcMain.handle(
    channels.CALL_TOOL,
    async (_event, name: string, args: Record<string, unknown>) => {
      try {
        return await serverManager.callTool(name, args);
      } catch (error) {
        log.error('CALL_TOOL error:', error);
        throw error;
      }
    }
  );

  // ============================================
  // Tool Manager
  // ============================================

  ipcMain.handle(
    channels.GET_TOOL_MANAGER_TOOLS,
    async (_event, options?: { hasUi?: boolean }) => {
      try {
        const tools = await serverManager.getToolManagerTools(options);
        return { tools };
      } catch (error) {
        log.error('GET_TOOL_MANAGER_TOOLS error:', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    channels.SET_TOOL_ENABLED,
    (_event, name: string, enabled: boolean) => {
      return serverManager.setToolEnabled(name, enabled);
    }
  );

  ipcMain.handle(channels.GET_TOOL_MANAGER_SERVERS, async () => {
    try {
      const servers = await serverManager.getToolManagerServers();
      return { servers };
    } catch (error) {
      log.error('GET_TOOL_MANAGER_SERVERS error:', error);
      throw error;
    }
  });

  ipcMain.handle(
    channels.SET_SERVER_ENABLED,
    (_event, name: string, enabled: boolean) => {
      return serverManager.setServerEnabled(name, enabled);
    }
  );

  // ============================================
  // Resources
  // ============================================

  ipcMain.handle(channels.GET_RESOURCES, async () => {
    try {
      const resources = await serverManager.getResources();
      return { resources };
    } catch (error) {
      log.error('GET_RESOURCES error:', error);
      throw error;
    }
  });

  ipcMain.handle(
    channels.READ_RESOURCE,
    async (_event, serverName: string, uri: string) => {
      try {
        return await serverManager.readResource(serverName, uri);
      } catch (error) {
        log.error('READ_RESOURCE error:', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    channels.GET_UI_RESOURCE,
    async (_event, serverName: string, uri: string) => {
      try {
        return await serverManager.getUIResource(serverName, uri);
      } catch (error) {
        log.error('GET_UI_RESOURCE error:', error);
        throw error;
      }
    }
  );

  // ============================================
  // Prompts
  // ============================================

  ipcMain.handle(channels.GET_PROMPTS, async () => {
    try {
      const prompts = await serverManager.getPrompts();
      return { prompts };
    } catch (error) {
      log.error('GET_PROMPTS error:', error);
      throw error;
    }
  });

  // ============================================
  // Chat Streaming
  // ============================================

  ipcMain.handle(
    channels.CHAT_STREAM_START,
    async (event, request: ChatRequest) => {
      const streamId = `stream-${++streamIdCounter}`;
      const controller = new AbortController();
      activeStreams.set(streamId, controller);

      // Start streaming in background
      handleChatStream(streamId, request, mainWindow, serverManager, controller.signal)
        .catch((error) => {
          log.error('Chat stream error:', error);
          sendStreamEvent(mainWindow, streamId, {
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        })
        .finally(() => {
          activeStreams.delete(streamId);
        });

      return streamId;
    }
  );

  ipcMain.handle(channels.CHAT_STREAM_CANCEL, (_event, streamId: string) => {
    const controller = activeStreams.get(streamId);
    if (controller) {
      controller.abort();
      activeStreams.delete(streamId);
    }
  });

  // ============================================
  // Settings
  // ============================================

  ipcMain.handle(channels.GET_SETTINGS, () => {
    return settingsStore.store;
  });

  ipcMain.handle(channels.SET_SETTINGS, (_event, settings: unknown) => {
    if (typeof settings === 'object' && settings !== null) {
      for (const [key, value] of Object.entries(settings)) {
        settingsStore.set(key, value);
      }
    }
  });

  // ============================================
  // Window Controls
  // ============================================

  ipcMain.handle(channels.WINDOW_MINIMIZE, () => {
    mainWindow.minimize();
  });

  ipcMain.handle(channels.WINDOW_MAXIMIZE, () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle(channels.WINDOW_CLOSE, () => {
    mainWindow.close();
  });

  // ============================================
  // Lifecycle Management
  // ============================================

  ipcMain.handle(channels.GET_SERVER_LIFECYCLE_STATES, async () => {
    try {
      const states = serverManager.getAllServerStates();
      return { states };
    } catch (error) {
      log.error('GET_SERVER_LIFECYCLE_STATES error:', error);
      throw error;
    }
  });

  ipcMain.handle(channels.RESTART_SERVER, async (_event, name: string) => {
    try {
      await serverManager.restartServer(name);
    } catch (error) {
      log.error('RESTART_SERVER error:', error);
      throw error;
    }
  });

  ipcMain.handle(channels.STOP_SERVER, async (_event, name: string) => {
    try {
      await serverManager.stopServer(name);
    } catch (error) {
      log.error('STOP_SERVER error:', error);
      throw error;
    }
  });

  ipcMain.handle(channels.START_SERVER, async (_event, name: string) => {
    try {
      await serverManager.startServer(name);
    } catch (error) {
      log.error('START_SERVER error:', error);
      throw error;
    }
  });

  log.info('IPC handlers registered');
}

export function cleanupIPCHandlers(): void {
  // Cancel all active streams
  for (const controller of activeStreams.values()) {
    controller.abort();
  }
  activeStreams.clear();

  // Remove all handlers
  for (const channel of channels.INVOKE_CHANNELS) {
    ipcMain.removeHandler(channel);
  }

  if (registeredServerManager) {
    registeredServerManager.setMainWindow(null);
  }
  registeredWindow = null;
  registeredServerManager = null;

  log.info('IPC handlers cleaned up');
}

// ============================================
// Chat Streaming Implementation
// ============================================

async function handleChatStream(
  streamId: string,
  request: ChatRequest,
  mainWindow: BrowserWindow,
  _serverManager: McpManager,
  signal: AbortSignal
): Promise<void> {
  try {
    // Merge settings with defaults
    const settings = mergeSettings(request.settings);

    // Build MCP context for system prompt
    const mcpContext: McpContext = request.mcpContext || {
      servers: [],
      availableTools: [],
    };

    // Build system prompt with MCP context
    const systemPrompt = buildSystemPrompt(mcpContext, settings.systemPrompt);

    // Convert messages to AI SDK format
    // Filter out empty messages and map to ModelMessage format
    const messages: ModelMessage[] = request.messages
      .filter((m) => m.content.trim() !== '')
      .map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

    // Stream response using the existing provider
    const chatStream = streamChat({
      messages,
      mcpContext,
      settings,
      systemPrompt,
    });

    // Iterate over the stream and forward events to renderer
    for await (const event of chatStream) {
      // Check if stream was cancelled
      if (signal.aborted) {
        break;
      }

      // Forward the event to the renderer
      sendStreamEvent(mainWindow, streamId, event);

      // If we received a done event, we're finished
      if (event.type === 'done') {
        break;
      }
    }

    // Ensure done is sent if not aborted and not already sent
    if (!signal.aborted) {
      // The stream may have already sent 'done', but sending again is harmless
      // The renderer should handle duplicate done events gracefully
    }
  } catch (error) {
    log.error('Chat stream error:', error);
    sendStreamEvent(mainWindow, streamId, {
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

function sendStreamEvent(
  mainWindow: BrowserWindow,
  streamId: string,
  event: StreamEvent
): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channels.CHAT_STREAM_EVENT, { streamId, event });
  }
}
