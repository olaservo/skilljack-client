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
import {
  previewMcpb,
  installMcpb,
  getManifestDisplayInfo,
  resolveDefaultValue,
  type McpbPreviewResult,
} from './mcpb/index.js';
import * as channels from '../../shared/channels.js';

// Import internal tool packages
import {
  MANAGE_TOOLS_TOOL as TOOL_MANAGER_TOOL,
  getToolManagerUI,
  TOOL_MANAGER_UI_URI,
  handleManageTools,
} from '@skilljack/internal-tool-manager';
import {
  SERVER_CONFIG_TOOL,
  SERVER_CONFIG_ACTION_TOOLS,
  ALL_SERVER_CONFIG_TOOLS,
  getServerConfigUI,
  getMcpbConfirmUI,
  SERVER_CONFIG_UI_URI,
  MCPB_CONFIRM_UI_URI,
  createServerConfigHandler,
  type ServerConfigDeps,
} from '@skilljack/internal-server-config';
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
  ContentAnnotations,
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
// MCP Manager Class
// ============================================

export class McpManager {
  private lifecycleManager: LifecycleManager | null = null;
  private toolState = new ToolManagerState();
  private mainWindow: BrowserWindow | null = null;
  private pendingMcpbPreview: McpbPreviewResult | null = null;
  private serverConfigHandler: ReturnType<typeof createServerConfigHandler>;

  constructor() {
    // Create server config handler with dependencies
    const deps: ServerConfigDeps = {
      getServerConfigs: async () => {
        const configs = await this.getServerConfigs();
        // Ensure enabled is always boolean (required by handler interface)
        return configs.map((c) => ({
          ...c,
          enabled: c.enabled ?? true,
        }));
      },
      addServerConfig: (config) => this.addServerConfig(config),
      removeServerConfig: (name) => this.removeServerConfig(name),
      restartServer: (name) => this.restartServer(name),
      stopServer: (name) => this.stopServer(name),
      startServer: (name) => this.startServer(name),
      setServerEnabled: (name, enabled) => { this.setServerEnabled(name, enabled); },
      previewMcpb: async (mcpbPath: string) => {
        const preview = await previewMcpb(mcpbPath);
        return {
          mcpbPath: preview.mcpbPath,
          manifest: {
            name: preview.manifest.name,
            display_name: preview.manifest.display_name,
            version: preview.manifest.version,
          },
          signature: preview.signature,
          platformCompatible: preview.platformCompatible,
          missingRequiredConfig: preview.missingRequiredConfig,
        };
      },
      setPendingMcpbPreview: (preview) => {
        // Store preview for later use - the UI will fetch it via getMcpbPreviewData
        if (preview && typeof preview === 'object' && 'mcpbPath' in preview) {
          previewMcpb((preview as { mcpbPath: string }).mcpbPath).then((p) => {
            this.pendingMcpbPreview = p;
          });
        }
      },
    };
    this.serverConfigHandler = createServerConfigHandler(deps);
  }

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
        version: s.serverVersion?.version,
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

  /**
   * Convert a package tool (with Zod schema) to ToolWithUIInfo (with JSON Schema).
   * This handles the difference between the package's Zod-based schemas and the app's expected format.
   */
  private convertPackageTool(tool: {
    name: string;
    displayName: string;
    title?: string;
    description: string;
    inputSchema?: unknown;
    hasUi: boolean;
    uiResourceUri?: string;
    serverName: string;
    annotations?: Record<string, unknown>;
  }): ToolWithUIInfo {
    return {
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      inputSchema: tool.inputSchema && typeof (tool.inputSchema as { _def?: unknown })._def === 'object'
        ? undefined  // Zod schema - let the caller use the Zod validation
        : tool.inputSchema as Record<string, unknown> | undefined,
      hasUi: tool.hasUi,
      uiResourceUri: tool.uiResourceUri,
      serverName: tool.serverName,
      annotations: tool.annotations,
    };
  }

  async getTools(options?: { hasUi?: boolean }): Promise<ToolWithUIInfo[]> {
    const clients = this.lifecycleManager?.getConnectedClients() ?? new Map();
    const allTools = await aggregateTools(clients);
    const modelVisibleTools = allTools.filter((t) => isToolVisibleToModel(t));
    let toolsWithUI = this.toolsToUIInfo(modelVisibleTools);

    if (options?.hasUi) {
      toolsWithUI = toolsWithUI.filter((t) => t.hasUi);
    }

    // Convert built-in tools from packages (with Zod schemas) to app format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builtInTools: ToolWithUIInfo[] = [
      this.convertPackageTool(TOOL_MANAGER_TOOL as any),
      this.convertPackageTool(SERVER_CONFIG_TOOL as any),
      ...SERVER_CONFIG_ACTION_TOOLS.map((t) => this.convertPackageTool(t as any)),
    ];

    // Add built-in tools and filter disabled tools
    return [
      ...builtInTools,
      ...this.toolState.filterEnabledTools(toolsWithUI),
    ];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    // Handle built-in tool-manager using imported handler
    if (name === 'tool-manager__manage-tools') {
      const result = handleManageTools();
      return {
        content: result.content,
        serverName: 'tool-manager',
      };
    }

    // Handle server-config tools using the imported handler
    if (name.startsWith('server-config__')) {
      // Special handling for install-mcpb to store preview data
      if (name === 'server-config__install-mcpb') {
        const { mcpbPath } = args as { mcpbPath: string };
        if (!mcpbPath) {
          return {
            content: [{ type: 'text', text: 'Missing required parameter: mcpbPath' }],
            serverName: 'server-config',
            isError: true,
          };
        }
        try {
          // Preview the MCPB and store for UI access
          const preview = await previewMcpb(mcpbPath);
          this.pendingMcpbPreview = preview;
          const displayInfo = getManifestDisplayInfo(preview.manifest);
          return {
            content: [{
              type: 'text',
              text: `Opening installation dialog for "${displayInfo.displayName}" v${displayInfo.version}...`,
            }],
            serverName: 'server-config',
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Failed to preview MCPB: ${err instanceof Error ? err.message : 'Unknown error'}` }],
            serverName: 'server-config',
            isError: true,
          };
        }
      }

      // Delegate to the imported handler for all other server-config tools
      const result = await this.serverConfigHandler(name, args);
      if (result) {
        return {
          content: result.content,
          isError: result.isError,
          serverName: result.serverName,
        };
      }
    }

    // Handle external MCP server tools
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
    // Handle built-in tool-manager UI using imported loader
    if (serverName === 'tool-manager' && uri === TOOL_MANAGER_UI_URI) {
      try {
        const html = getToolManagerUI();
        log.info('[McpManager] Loaded tool-manager UI from package');
        return {
          uri,
          mimeType: 'text/html;mcp-app',
          text: html,
          serverName: 'tool-manager',
        };
      } catch (err) {
        log.error('[McpManager] Failed to load tool-manager UI:', err);
        return null;
      }
    }

    // Handle built-in server-config UI using imported loader
    if (serverName === 'server-config' && uri === SERVER_CONFIG_UI_URI) {
      try {
        const html = getServerConfigUI();
        log.info('[McpManager] Loaded server-config UI from package');
        return {
          uri,
          mimeType: 'text/html;mcp-app',
          text: html,
          serverName: 'server-config',
        };
      } catch (err) {
        log.error('[McpManager] Failed to load server-config UI:', err);
        return null;
      }
    }

    // Handle built-in mcpb-confirm UI using imported loader
    if (serverName === 'server-config' && uri === MCPB_CONFIRM_UI_URI) {
      try {
        const html = getMcpbConfirmUI();
        log.info('[McpManager] Loaded mcpb-confirm UI from package');
        return {
          uri,
          mimeType: 'text/html;mcp-app',
          text: html,
          serverName: 'server-config',
        };
      } catch (err) {
        log.error('[McpManager] Failed to load mcpb-confirm UI:', err);
        return null;
      }
    }

    // Handle external MCP server resources
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
  // MCPB Installation
  // ============================================

  /**
   * Get pending MCPB preview data for the confirmation UI
   */
  getMcpbPreviewData(): {
    mcpbPath: string;
    manifest: ReturnType<typeof getManifestDisplayInfo>;
    signature: McpbPreviewResult['signature'];
    platformCompatible: boolean;
    missingRequiredConfig: string[];
  } | null {
    if (!this.pendingMcpbPreview) {
      return null;
    }

    const displayInfo = getManifestDisplayInfo(this.pendingMcpbPreview.manifest);

    // Resolve default values for user config fields
    const userConfigFields = displayInfo.userConfigFields.map(field => ({
      ...field,
      default: resolveDefaultValue(field.default as string | number | boolean | string[] | undefined),
    }));

    return {
      mcpbPath: this.pendingMcpbPreview.mcpbPath,
      manifest: {
        ...displayInfo,
        userConfigFields,
      },
      signature: this.pendingMcpbPreview.signature,
      platformCompatible: this.pendingMcpbPreview.platformCompatible,
      missingRequiredConfig: this.pendingMcpbPreview.missingRequiredConfig,
    };
  }

  /**
   * Confirm and complete MCPB installation
   */
  async confirmMcpbInstall(
    mcpbPath: string,
    userConfig?: Record<string, unknown>
  ): Promise<{ success: boolean; message: string; serverName?: string }> {
    try {
      // Install the MCPB
      const result = await installMcpb({
        mcpbPath,
        userConfig,
      });

      if (!result.success) {
        return {
          success: false,
          message: result.message,
        };
      }

      // Add server to configuration if installation succeeded
      if (result.config) {
        const configPath = store.get('configPath');
        if (!configPath) {
          // Create new config file if it doesn't exist
          const newConfigPath = join(app.getPath('userData'), 'servers.json');
          await writeFile(
            newConfigPath,
            JSON.stringify({ mcpServers: {} }, null, 2),
            'utf-8'
          );
          store.set('configPath', newConfigPath);
        }

        // Add the server using the resolved config
        await this.addServerConfig({
          name: result.serverName,
          command: result.config.command,
          args: result.config.args,
          env: result.config.env,
        });
      }

      // Clear pending preview
      this.pendingMcpbPreview = null;

      return {
        success: true,
        message: result.message,
        serverName: result.serverName,
      };
    } catch (error) {
      log.error('[MCPB] Installation failed:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Installation failed',
      };
    }
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
