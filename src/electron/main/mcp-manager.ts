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
import { readFile, writeFile } from 'node:fs/promises';
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
  ServerConfigEntry,
  ServerConfigWithStatus,
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
  description: 'SHOW or DISPLAY the tool manager UI. Use when user wants to SEE, VIEW, or SHOW available tools. Opens a visual panel to browse and toggle tools on/off.',
  hasUi: true,
  uiResourceUri: 'builtin://tool-manager',
  serverName: 'tool-manager',
};

const SERVER_CONFIG_TOOL: ToolWithUIInfo = {
  name: 'server-config__configure-servers',
  displayName: 'configure-servers',
  description: 'SHOW or DISPLAY the server configuration UI. Use when user wants to SEE, VIEW, or SHOW server connections. Opens a visual panel to manage servers.',
  hasUi: true,
  uiResourceUri: 'builtin://server-config',
  serverName: 'server-config',
};

// ============================================
// Server Config Action Tools (no UI, direct actions)
// ============================================

const SERVER_LIST_TOOL: ToolWithUIInfo = {
  name: 'server-config__list-servers',
  displayName: 'list-servers',
  description: 'Get server status as text data. Use for checking connection status programmatically. If user wants to SEE/SHOW/VIEW servers visually, use configure-servers instead.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  hasUi: false,
  serverName: 'server-config',
};

const SERVER_ADD_TOOL: ToolWithUIInfo = {
  name: 'server-config__add-server',
  displayName: 'add-server',
  description: 'Add a new MCP server connection. The server will be started automatically after adding.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Unique name for the server (e.g., "filesystem", "github")',
      },
      command: {
        type: 'string',
        description: 'Command to run (e.g., "npx", "node", "python")',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Command arguments (e.g., ["-y", "@modelcontextprotocol/server-filesystem", "/home"])',
      },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Environment variables (e.g., {"GITHUB_TOKEN": "..."})',
      },
    },
    required: ['name', 'command'],
  },
  hasUi: false,
  serverName: 'server-config',
};

const SERVER_REMOVE_TOOL: ToolWithUIInfo = {
  name: 'server-config__remove-server',
  displayName: 'remove-server',
  description: 'Remove an MCP server from the configuration. The server will be disconnected.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the server to remove',
      },
    },
    required: ['name'],
  },
  hasUi: false,
  serverName: 'server-config',
};

const SERVER_RESTART_TOOL: ToolWithUIInfo = {
  name: 'server-config__restart-server',
  displayName: 'restart-server',
  description: 'Restart an MCP server. Useful when a server becomes unresponsive or after configuration changes.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the server to restart',
      },
    },
    required: ['name'],
  },
  hasUi: false,
  serverName: 'server-config',
};

const SERVER_STOP_TOOL: ToolWithUIInfo = {
  name: 'server-config__stop-server',
  displayName: 'stop-server',
  description: 'Stop a running MCP server. The server can be started again later.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the server to stop',
      },
    },
    required: ['name'],
  },
  hasUi: false,
  serverName: 'server-config',
};

const SERVER_START_TOOL: ToolWithUIInfo = {
  name: 'server-config__start-server',
  displayName: 'start-server',
  description: 'Start a stopped MCP server.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the server to start',
      },
    },
    required: ['name'],
  },
  hasUi: false,
  serverName: 'server-config',
};

// All server-config action tools
const SERVER_CONFIG_ACTION_TOOLS: ToolWithUIInfo[] = [
  SERVER_LIST_TOOL,
  SERVER_ADD_TOOL,
  SERVER_REMOVE_TOOL,
  SERVER_RESTART_TOOL,
  SERVER_STOP_TOOL,
  SERVER_START_TOOL,
];

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

    // Add built-in tools and filter disabled tools
    return [
      TOOL_MANAGER_TOOL,
      SERVER_CONFIG_TOOL,
      ...SERVER_CONFIG_ACTION_TOOLS,
      ...this.toolState.filterEnabledTools(toolsWithUI),
    ];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    // Handle built-in tool-manager
    if (name === 'tool-manager__manage-tools') {
      return {
        content: [{ type: 'text', text: 'Tool manager opened.' }],
        serverName: 'tool-manager',
      };
    }

    // Handle built-in server-config
    if (name === 'server-config__configure-servers') {
      return {
        content: [{ type: 'text', text: 'Server configuration opened.' }],
        serverName: 'server-config',
      };
    }

    // Handle server-config action tools
    if (name === 'server-config__list-servers') {
      const servers = await this.getServerConfigs();
      const summary = servers.map(s =>
        `- **${s.name}**: ${s.status} (${s.toolCount} tools)${s.lastError ? ` - Error: ${s.lastError}` : ''}`
      ).join('\n');
      return {
        content: [{
          type: 'text',
          text: servers.length > 0
            ? `## Connected Servers\n\n${summary}`
            : 'No servers configured. Use add-server to add one.'
        }],
        serverName: 'server-config',
      };
    }

    if (name === 'server-config__add-server') {
      const { name: serverName, command, args: serverArgs, env } = args as {
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      };
      try {
        await this.addServerConfig({ name: serverName, command, args: serverArgs, env });
        return {
          content: [{ type: 'text', text: `Server "${serverName}" added and starting...` }],
          serverName: 'server-config',
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to add server: ${err instanceof Error ? err.message : 'Unknown error'}` }],
          serverName: 'server-config',
          isError: true,
        };
      }
    }

    if (name === 'server-config__remove-server') {
      const { name: serverName } = args as { name: string };
      try {
        await this.removeServerConfig(serverName);
        return {
          content: [{ type: 'text', text: `Server "${serverName}" removed.` }],
          serverName: 'server-config',
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to remove server: ${err instanceof Error ? err.message : 'Unknown error'}` }],
          serverName: 'server-config',
          isError: true,
        };
      }
    }

    if (name === 'server-config__restart-server') {
      const { name: serverName } = args as { name: string };
      try {
        await this.restartServer(serverName);
        return {
          content: [{ type: 'text', text: `Server "${serverName}" is restarting...` }],
          serverName: 'server-config',
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to restart server: ${err instanceof Error ? err.message : 'Unknown error'}` }],
          serverName: 'server-config',
          isError: true,
        };
      }
    }

    if (name === 'server-config__stop-server') {
      const { name: serverName } = args as { name: string };
      try {
        await this.stopServer(serverName);
        return {
          content: [{ type: 'text', text: `Server "${serverName}" stopped.` }],
          serverName: 'server-config',
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to stop server: ${err instanceof Error ? err.message : 'Unknown error'}` }],
          serverName: 'server-config',
          isError: true,
        };
      }
    }

    if (name === 'server-config__start-server') {
      const { name: serverName } = args as { name: string };
      try {
        await this.startServer(serverName);
        return {
          content: [{ type: 'text', text: `Server "${serverName}" starting...` }],
          serverName: 'server-config',
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to start server: ${err instanceof Error ? err.message : 'Unknown error'}` }],
          serverName: 'server-config',
          isError: true,
        };
      }
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
        // In development, the file is in src/web/static/
        // In production, it would be in the app resources
        const appPath = app.getAppPath();
        const possiblePaths = [
          // Development: relative to app root
          join(appPath, 'src/web/static/tool-manager/mcp-app.html'),
          // Production: in resources folder
          join(appPath, 'resources/tool-manager/mcp-app.html'),
          // Fallback: relative to __dirname (original path)
          join(__dirname, '../../web/static/tool-manager/mcp-app.html'),
          join(__dirname, '../../../src/web/static/tool-manager/mcp-app.html'),
        ];

        for (const htmlPath of possiblePaths) {
          if (existsSync(htmlPath)) {
            const html = await readFile(htmlPath, 'utf-8');
            log.info('[McpManager] Loaded tool-manager UI from:', htmlPath);
            return {
              uri,
              mimeType: 'text/html;mcp-app',
              text: html,
              serverName: 'tool-manager',
            };
          }
        }

        log.warn('[McpManager] Tool-manager UI not found. Tried paths:', possiblePaths);
        return null;
      } catch (err) {
        log.error('[McpManager] Failed to load tool-manager UI:', err);
        return null;
      }
    }

    // Handle built-in server-config UI
    if (serverName === 'server-config' && uri === 'builtin://server-config') {
      try {
        const appPath = app.getAppPath();
        const possiblePaths = [
          // Development: relative to app root
          join(appPath, 'src/web/static/server-config/mcp-app.html'),
          // Production: in resources folder
          join(appPath, 'resources/server-config/mcp-app.html'),
          // Fallback: relative to __dirname
          join(__dirname, '../../web/static/server-config/mcp-app.html'),
          join(__dirname, '../../../src/web/static/server-config/mcp-app.html'),
        ];

        for (const htmlPath of possiblePaths) {
          if (existsSync(htmlPath)) {
            const html = await readFile(htmlPath, 'utf-8');
            log.info('[McpManager] Loaded server-config UI from:', htmlPath);
            return {
              uri,
              mimeType: 'text/html;mcp-app',
              text: html,
              serverName: 'server-config',
            };
          }
        }

        log.warn('[McpManager] Server-config UI not found. Tried paths:', possiblePaths);
        return null;
      } catch (err) {
        log.error('[McpManager] Failed to load server-config UI:', err);
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
  // Server Configuration
  // ============================================

  /**
   * Get all server configurations with their current status
   */
  async getServerConfigs(): Promise<ServerConfigWithStatus[]> {
    const configPath = store.get('configPath');
    if (!configPath || !existsSync(configPath)) {
      return [];
    }

    try {
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content) as { mcpServers?: Record<string, unknown> };
      const servers = config.mcpServers || {};
      const states = this.lifecycleManager?.getAllServerStates() ?? [];
      const serverSummary = await this.getServers();

      return Object.entries(servers).map(([name, serverConfig]) => {
        const cfg = serverConfig as { command?: string; args?: string[]; env?: Record<string, string> };
        const state = states.find((s) => s.name === name);
        const summary = serverSummary.find((s) => s.name === name);

        return {
          name,
          transport: 'stdio' as const,
          command: cfg.command || '',
          args: cfg.args,
          env: cfg.env,
          enabled: this.toolState.isServerEnabled(name),
          status: state?.status ?? 'disconnected',
          toolCount: summary?.toolCount ?? 0,
          healthy: state?.healthy ?? false,
          lastError: state?.error,
        };
      });
    } catch (error) {
      log.error('Failed to read server configs:', error);
      return [];
    }
  }

  /**
   * Add a new server to the configuration
   */
  async addServerConfig(config: {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }): Promise<void> {
    const configPath = store.get('configPath');
    if (!configPath) {
      throw new Error('No configuration file path set');
    }

    // Read current config
    let fileConfig: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };
    if (existsSync(configPath)) {
      const content = await readFile(configPath, 'utf-8');
      fileConfig = JSON.parse(content);
    }

    // Check for duplicate
    if (fileConfig.mcpServers && fileConfig.mcpServers[config.name]) {
      throw new Error(`Server '${config.name}' already exists`);
    }

    // Add new server
    fileConfig.mcpServers = fileConfig.mcpServers || {};
    fileConfig.mcpServers[config.name] = {
      transport: 'stdio',
      command: config.command,
      args: config.args || [],
      env: config.env,
    };

    // Write back
    await writeFile(configPath, JSON.stringify(fileConfig, null, 2), 'utf-8');
    log.info(`Added server config: ${config.name}`);

    // Reload configuration to connect new server
    await this.loadConfig(configPath);
  }

  /**
   * Update an existing server configuration
   */
  async updateServerConfig(
    name: string,
    config: {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      enabled?: boolean;
    }
  ): Promise<void> {
    const configPath = store.get('configPath');
    if (!configPath || !existsSync(configPath)) {
      throw new Error('No configuration file found');
    }

    // Handle enabled state separately (it's stored in electron-store, not servers.json)
    if (config.enabled !== undefined) {
      this.toolState.setServerEnabled(name, config.enabled);
    }

    // If only changing enabled state, no need to modify the config file
    if (config.command === undefined && config.args === undefined && config.env === undefined) {
      return;
    }

    // Read current config
    const content = await readFile(configPath, 'utf-8');
    const fileConfig = JSON.parse(content) as { mcpServers?: Record<string, unknown> };

    if (!fileConfig.mcpServers || !fileConfig.mcpServers[name]) {
      throw new Error(`Server '${name}' not found`);
    }

    const existing = fileConfig.mcpServers[name] as Record<string, unknown>;

    // Update fields
    if (config.command !== undefined) {
      existing.command = config.command;
    }
    if (config.args !== undefined) {
      existing.args = config.args;
    }
    if (config.env !== undefined) {
      existing.env = config.env;
    }

    // Write back
    await writeFile(configPath, JSON.stringify(fileConfig, null, 2), 'utf-8');
    log.info(`Updated server config: ${name}`);

    // Reload configuration to apply changes
    await this.loadConfig(configPath);
  }

  /**
   * Remove a server from the configuration
   */
  async removeServerConfig(name: string): Promise<void> {
    const configPath = store.get('configPath');
    if (!configPath || !existsSync(configPath)) {
      throw new Error('No configuration file found');
    }

    // Read current config
    const content = await readFile(configPath, 'utf-8');
    const fileConfig = JSON.parse(content) as { mcpServers?: Record<string, unknown> };

    if (!fileConfig.mcpServers || !fileConfig.mcpServers[name]) {
      throw new Error(`Server '${name}' not found`);
    }

    // Remove server
    delete fileConfig.mcpServers[name];

    // Write back
    await writeFile(configPath, JSON.stringify(fileConfig, null, 2), 'utf-8');
    log.info(`Removed server config: ${name}`);

    // Reload configuration
    await this.loadConfig(configPath);
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
