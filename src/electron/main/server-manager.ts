/**
 * Electron Server Manager
 *
 * Wraps multi-server.ts functionality for the Electron main process.
 * Manages MCP client connections and provides methods for IPC handlers.
 */

import { app, BrowserWindow } from 'electron';
import Store from 'electron-store';
import log from 'electron-log';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  loadMultiServerConfig,
  connectToAllServers,
  disconnectAll,
  aggregateTools,
  aggregatePrompts,
  aggregateResources,
  callTool,
  readResource,
  getServersSummary,
  setupAllCapabilities,
  type MultiServerConfig,
  type AggregatedTool,
} from '../../multi-server.js';
import { getToolUiResourceUri, fetchUIResource, isToolVisibleToModel } from '../../capabilities/apps.js';
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
// Tool Manager State
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
// Server Manager Class
// ============================================

export class ServerManager {
  private clients = new Map<string, Client>();
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
    const config = await loadMultiServerConfig(path);
    await this.connectServers(config);
    store.set('configPath', path);
  }

  async connectServers(config: MultiServerConfig): Promise<void> {
    // Disconnect existing clients
    if (this.clients.size > 0) {
      await disconnectAll(this.clients);
    }

    // Connect to all servers
    this.clients = await connectToAllServers(config, {
      continueOnError: true,
      onConnect: (name, _client) => {
        log.info(`Connected to MCP server: ${name}`);
        this.notifyServersChanged();
      },
      onError: (name, error) => {
        log.error(`Failed to connect to ${name}:`, error.message);
        this.notifyConnectionError(name, error.message);
      },
    });

    // Set up capabilities
    setupAllCapabilities(this.clients, {
      listChanged: {
        onToolsChanged: (_serverName, _tools) => {
          this.notifyToolsChanged();
        },
        onResourcesChanged: (_serverName, _resources) => {
          this.notifyServersChanged();
        },
      },
      onResourceUpdated: (serverName, uri) => {
        this.notifyResourceUpdated(serverName, uri);
      },
      onLogMessage: (serverName, level, logger, data) => {
        log.info(`[${serverName}][${level}] ${logger}:`, data);
      },
    });
  }

  async shutdown(): Promise<void> {
    await disconnectAll(this.clients);
    this.clients.clear();
  }

  // ============================================
  // Server Information
  // ============================================

  async getServers(): Promise<ServerSummary[]> {
    const summary = await getServersSummary(this.clients);
    return summary.map((s) => ({
      name: s.name,
      version: s.serverVersion?.name,
      toolCount: s.toolCount,
    }));
  }

  getConfig(): WebConfig {
    return {
      sandboxPort: 0, // Not used in Electron mode
      multiServer: true,
      serverCount: this.clients.size,
    };
  }

  // ============================================
  // Tools
  // ============================================

  async getTools(options?: { hasUi?: boolean }): Promise<ToolWithUIInfo[]> {
    const allTools = await aggregateTools(this.clients);
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

    const { serverName, result } = await callTool(this.clients, name, args, {
      timeout: 120000,
    });
    return { ...result, serverName };
  }

  // ============================================
  // Tool Manager
  // ============================================

  async getToolManagerTools(options?: { hasUi?: boolean }): Promise<ToolWithEnabledState[]> {
    const allTools = await aggregateTools(this.clients);
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
    const allTools = await aggregateTools(this.clients);
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
    const resources = await aggregateResources(this.clients);
    return resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
      serverName: r.serverName,
    }));
  }

  async readResource(serverName: string, uri: string): Promise<unknown> {
    const client = this.clients.get(serverName);
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

    const client = this.clients.get(serverName);
    if (!client) {
      return null;
    }

    const resource = await fetchUIResource(client, uri);
    if (resource) {
      return { ...resource, serverName };
    }
    return null;
  }

  // ============================================
  // Prompts
  // ============================================

  async getPrompts(): Promise<PromptInfo[]> {
    const prompts = await aggregatePrompts(this.clients);
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
  // Event Notifications
  // ============================================

  private notifyToolsChanged(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mcp:on-tools-changed');
    }
  }

  private notifyServersChanged(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mcp:on-servers-changed');
    }
  }

  private notifyResourceUpdated(serverName: string, uri: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mcp:on-resource-updated', { serverName, uri });
    }
  }

  private notifyConnectionError(serverName: string, error: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('mcp:on-connection-error', { serverName, error });
    }
  }
}
