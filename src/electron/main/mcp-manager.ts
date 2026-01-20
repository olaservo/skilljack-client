/**
 * MCP Manager
 *
 * Orchestrates three independent modules:
 * 1. @skilljack/mcp-server-manager - Lifecycle management (connect, health, restart)
 * 2. multi-server.ts - Tool/resource aggregation
 * 3. ToolManagerState - Enabled/disabled persistence (electron-store)
 *
 * This wrapper is intentionally thin (~150 lines of orchestration).
 */

import { app, BrowserWindow } from 'electron';
import Store from 'electron-store';
import log from 'electron-log';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  ServerManager as LifecycleManager,
  type ServerStateSummary,
  type LifecycleEvent,
  type ManagerEvent,
  ConsoleLoggerFactory,
} from '@skilljack/mcp-server-manager';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  loadMultiServerConfig,
  aggregateTools,
  aggregatePrompts,
  aggregateResources,
  callTool,
  getServersSummary,
  setupAllCapabilities,
  type AggregatedTool,
} from '../../multi-server.js';
import { getToolUiResourceUri, fetchUIResource, isToolVisibleToModel } from '../../capabilities/apps.js';
import { convertLegacyConfig } from './config-adapter.js';
import * as channels from '../../shared/channels.js';
import type {
  ServerSummary,
  ToolWithUIInfo,
  ToolWithEnabledState,
  ToolCallResult,
  ResourceInfo,
  UIResource,
  PromptInfo,
  WebConfig,
  ServerWithState,
} from '../../shared/types.js';

// ============================================
// Settings Store
// ============================================

interface StoreSchema {
  configPath?: string;
  disabledTools: string[];
  disabledServers: string[];
}

const store = new Store<StoreSchema>({
  defaults: {
    disabledTools: [],
    disabledServers: [],
  },
});

// ============================================
// Tool Manager State (independent module)
// ============================================

class ToolManagerState {
  private disabledTools = new Set<string>(store.get('disabledTools'));
  private disabledServers = new Set<string>(store.get('disabledServers'));

  isToolEnabled(name: string): boolean {
    return !this.disabledTools.has(name);
  }

  setToolEnabled(name: string, enabled: boolean): void {
    if (enabled) {
      this.disabledTools.delete(name);
    } else {
      this.disabledTools.add(name);
    }
    store.set('disabledTools', Array.from(this.disabledTools));
  }

  isServerEnabled(name: string): boolean {
    return !this.disabledServers.has(name);
  }

  setServerEnabled(name: string, enabled: boolean): void {
    if (enabled) {
      this.disabledServers.delete(name);
    } else {
      this.disabledServers.add(name);
    }
    store.set('disabledServers', Array.from(this.disabledServers));
  }

  filterEnabledTools<T extends { name: string; serverName: string }>(tools: T[]): T[] {
    return tools.filter(
      (t) => this.isToolEnabled(t.name) && this.isServerEnabled(t.serverName)
    );
  }

  addEnabledState<T extends { name: string; serverName: string }>(
    tools: T[]
  ): Array<T & { enabled: boolean }> {
    return tools.map((t) => ({
      ...t,
      enabled: this.isToolEnabled(t.name) && this.isServerEnabled(t.serverName),
    }));
  }

  getServersWithState(tools: ToolWithUIInfo[]): ServerWithState[] {
    const serverMap = new Map<string, { total: number; enabled: number }>();

    for (const tool of tools) {
      const existing = serverMap.get(tool.serverName) || { total: 0, enabled: 0 };
      existing.total++;
      if (this.isToolEnabled(tool.name)) {
        existing.enabled++;
      }
      serverMap.set(tool.serverName, existing);
    }

    return Array.from(serverMap.entries()).map(([name, counts]) => ({
      name,
      enabled: this.isServerEnabled(name),
      toolCount: counts.total,
      enabledToolCount: counts.enabled,
    }));
  }
}

// ============================================
// Built-in Tool Manager Tool
// ============================================

const TOOL_MANAGER_TOOL: ToolWithUIInfo = {
  name: 'tool-manager__manage-tools',
  displayName: 'manage-tools',
  description: 'View and enable/disable tools from connected MCP servers',
  hasUi: true,
  uiResourceUri: 'builtin://tool-manager',
  serverName: 'tool-manager',
};

// ============================================
// MCP Manager Class
// ============================================

export class McpManager {
  private lifecycleManager: LifecycleManager | null = null;
  private toolState = new ToolManagerState();
  private mainWindow: BrowserWindow | null = null;

  async initialize(): Promise<void> {
    // Try to load config from default locations
    const configPaths = [
      store.get('configPath'),
      join(app.getPath('userData'), 'servers.json'),
      join(process.cwd(), 'servers.json'),
    ].filter(Boolean) as string[];

    for (const configPath of configPaths) {
      if (existsSync(configPath)) {
        try {
          await this.loadConfig(configPath);
          log.info(`Loaded MCP config from: ${configPath}`);
          return;
        } catch (error) {
          log.warn(`Failed to load config from ${configPath}:`, error);
        }
      }
    }

    log.info('No MCP server config found, starting without servers');
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  async loadConfig(path: string): Promise<void> {
    // Load legacy config and convert to new format
    const legacyConfig = await loadMultiServerConfig(path);
    const managerConfig = convertLegacyConfig(legacyConfig);

    // Shutdown existing manager if any
    if (this.lifecycleManager) {
      await this.lifecycleManager.shutdown();
    }

    // Create new lifecycle manager
    this.lifecycleManager = LifecycleManager.fromConfig(managerConfig, {
      loggerFactory: new ConsoleLoggerFactory(),
    });

    // Wire up lifecycle events to IPC
    this.setupEventBridge();

    // Start all servers
    await this.lifecycleManager.start();

    // Setup MCP capabilities on connected clients
    const clients = this.lifecycleManager.getConnectedClients();
    this.setupCapabilities(clients);

    store.set('configPath', path);
  }

  private setupEventBridge(): void {
    if (!this.lifecycleManager) return;

    // Forward all lifecycle events to renderer
    this.lifecycleManager.onAnyLifecycleEvent((event: LifecycleEvent) => {
      const payload = {
        ...event,
        timestamp: event.timestamp.toISOString(),
      };

      // Send to appropriate channel based on event type
      switch (event.type) {
        case 'server:status-changed':
          this.sendToRenderer(channels.ON_SERVER_STATUS_CHANGED, payload);
          // Also trigger servers changed for backward compatibility
          this.sendToRenderer(channels.ON_SERVERS_CHANGED, undefined);
          break;
        case 'server:healthy':
          this.sendToRenderer(channels.ON_SERVER_HEALTHY, payload);
          break;
        case 'server:unhealthy':
          this.sendToRenderer(channels.ON_SERVER_UNHEALTHY, payload);
          break;
        case 'server:crashed':
          this.sendToRenderer(channels.ON_SERVER_CRASHED, payload);
          break;
        case 'server:restarting':
          this.sendToRenderer(channels.ON_SERVER_RESTARTING, payload);
          break;
        case 'server:connected':
          this.sendToRenderer(channels.ON_SERVERS_CHANGED, undefined);
          // Re-setup capabilities when a server reconnects
          const clients = this.lifecycleManager?.getConnectedClients();
          if (clients) this.setupCapabilities(clients);
          break;
        case 'server:connection-failed':
          this.sendToRenderer(channels.ON_CONNECTION_ERROR, {
            serverName: event.serverName,
            error: event.error,
          });
          break;
      }
    });

    // Forward manager events
    this.lifecycleManager.onManagerEvent('manager:ready', (event: ManagerEvent) => {
      if (event.type === 'manager:ready') {
        this.sendToRenderer(channels.ON_MANAGER_READY, {
          serverCount: event.serverCount,
          timestamp: event.timestamp.toISOString(),
        });
      }
    });
  }

  private setupCapabilities(clients: Map<string, Client>): void {
    setupAllCapabilities(clients, {
      listChanged: {
        onToolsChanged: (_serverName, _tools) => {
          this.notifyToolsChanged();
        },
        onResourcesChanged: (_serverName, _resources) => {
          this.sendToRenderer(channels.ON_SERVERS_CHANGED, undefined);
        },
      },
      onResourceUpdated: (serverName, uri) => {
        this.sendToRenderer(channels.ON_RESOURCE_UPDATED, { serverName, uri });
      },
      onLogMessage: (serverName, level, logger, data) => {
        log.info(`[${serverName}][${level}] ${logger}:`, data);
      },
    });
  }

  async shutdown(): Promise<void> {
    if (this.lifecycleManager) {
      await this.lifecycleManager.shutdown();
      this.lifecycleManager = null;
    }
  }

  // ============================================
  // Lifecycle Management
  // ============================================

  getAllServerStates(): ServerStateSummary[] {
    return this.lifecycleManager?.getAllServerStates() ?? [];
  }

  async restartServer(name: string): Promise<void> {
    await this.lifecycleManager?.restartServer(name);
  }

  async stopServer(name: string): Promise<void> {
    await this.lifecycleManager?.stopServer(name);
  }

  async startServer(name: string): Promise<void> {
    await this.lifecycleManager?.startServer(name);
  }

  // ============================================
  // Server Information
  // ============================================

  async getServers(): Promise<ServerSummary[]> {
    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    const summary = await getServersSummary(clients);
    const states = this.lifecycleManager?.getAllServerStates() ?? [];

    return summary.map((s) => {
      const state = states.find((st) => st.name === s.name);
      return {
        name: s.name,
        version: s.serverVersion?.name,
        status: state?.status ?? 'disconnected',
        toolCount: s.toolCount,
        healthy: state?.healthy,
        restartAttempts: state?.restartAttempts,
        error: state?.error,
      };
    });
  }

  getConfig(): WebConfig {
    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    return {
      sandboxPort: 0, // Not used in Electron mode
      multiServer: true,
      serverCount: clients.size,
    };
  }

  // ============================================
  // Tools (uses multi-server.ts aggregation)
  // ============================================

  async getTools(options?: { hasUi?: boolean }): Promise<ToolWithUIInfo[]> {
    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    const allTools = await aggregateTools(clients);
    const modelVisibleTools = allTools.filter((t) => isToolVisibleToModel(t));
    let toolsWithUI = this.toolsToUIInfo(modelVisibleTools);

    if (options?.hasUi) {
      toolsWithUI = toolsWithUI.filter((t) => t.hasUi);
    }

    // Add tool-manager and filter disabled tools
    return [TOOL_MANAGER_TOOL, ...this.toolState.filterEnabledTools(toolsWithUI)];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    // Handle built-in tool-manager
    if (name === 'tool-manager__manage-tools') {
      return {
        content: [{ type: 'text', text: 'Tool manager opened.' }],
        serverName: 'tool-manager',
      };
    }

    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    const { serverName, result } = await callTool(clients, name, args, {
      timeout: 120000,
    });
    return {
      content: result.content,
      isError: result.isError === true,
      serverName,
    };
  }

  // ============================================
  // Tool Manager
  // ============================================

  async getToolManagerTools(options?: { hasUi?: boolean }): Promise<ToolWithEnabledState[]> {
    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    const allTools = await aggregateTools(clients);
    let toolsWithUI = this.toolsToUIInfo(allTools);

    if (options?.hasUi) {
      toolsWithUI = toolsWithUI.filter((t) => t.hasUi);
    }

    return this.toolState.addEnabledState(toolsWithUI);
  }

  setToolEnabled(name: string, enabled: boolean): { name: string; enabled: boolean } {
    this.toolState.setToolEnabled(name, enabled);
    this.notifyToolsChanged();
    return { name, enabled: this.toolState.isToolEnabled(name) };
  }

  async getToolManagerServers(): Promise<ServerWithState[]> {
    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    const allTools = await aggregateTools(clients);
    const toolsWithUI = this.toolsToUIInfo(allTools);
    return this.toolState.getServersWithState(toolsWithUI);
  }

  setServerEnabled(name: string, enabled: boolean): { name: string; enabled: boolean } {
    this.toolState.setServerEnabled(name, enabled);
    this.notifyToolsChanged();
    return { name, enabled: this.toolState.isServerEnabled(name) };
  }

  // ============================================
  // Resources
  // ============================================

  async getResources(): Promise<ResourceInfo[]> {
    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    const resources = await aggregateResources(clients);
    return resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
      serverName: r.serverName,
    }));
  }

  async readResource(serverName: string, uri: string): Promise<unknown> {
    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    const client = clients.get(serverName);
    if (!client) {
      throw new Error(`Server not found: ${serverName}`);
    }
    return client.readResource({ uri });
  }

  async getUIResource(serverName: string, uri: string): Promise<UIResource | null> {
    // Handle built-in tool-manager UI
    if (serverName === 'tool-manager' && uri === 'builtin://tool-manager') {
      try {
        // Read from the static folder
        const htmlPath = join(__dirname, '../../web/static/tool-manager/mcp-app.html');
        const html = await readFile(htmlPath, 'utf-8');
        return {
          uri,
          mimeType: 'text/html;mcp-app',
          text: html,
          serverName: 'tool-manager',
        };
      } catch {
        return null;
      }
    }

    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    const client = clients.get(serverName);
    if (!client) {
      return null;
    }

    const resource = await fetchUIResource(client, uri);
    if (resource) {
      return {
        uri,
        mimeType: 'text/html;mcp-app',
        text: resource.html,
        serverName,
      };
    }
    return null;
  }

  // ============================================
  // Prompts
  // ============================================

  async getPrompts(): Promise<PromptInfo[]> {
    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    const prompts = await aggregatePrompts(clients);
    return prompts.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
      serverName: p.serverName,
    }));
  }

  // ============================================
  // Helper Methods
  // ============================================

  private toolsToUIInfo(tools: AggregatedTool[]): ToolWithUIInfo[] {
    return tools.map((tool) => {
      const uiResourceUri = getToolUiResourceUri(tool);
      return {
        name: tool.name,
        displayName: tool.originalName,
        description: tool.description,
        hasUi: !!uiResourceUri,
        uiResourceUri,
        serverName: tool.serverName,
      };
    });
  }

  // ============================================
  // IPC Notification Helpers
  // ============================================

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  private notifyToolsChanged(): void {
    this.sendToRenderer(channels.ON_TOOLS_CHANGED, undefined);
  }
}
