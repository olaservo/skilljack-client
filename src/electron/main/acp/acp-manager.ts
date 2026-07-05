/**
 * ACP Manager
 *
 * Top-level singleton (mirrors McpManager): owns the agent registry,
 * one AcpAgentConnection per running agent, session→agent routing, and
 * event fan-out to the renderer over the acp:* channels.
 */

import { BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import log from 'electron-log';
import type { McpServer } from '@agentclientprotocol/sdk';
import {
  ACP_AGENT_STATUS_CHANGED,
  ACP_OPEN_APP,
  ACP_PERMISSION_REQUEST,
  ACP_SESSION_UPDATE,
} from '../../../shared/channels.js';
import type {
  AcpAgentConfig,
  AcpAgentInfo,
  AcpAgentStatus,
  AcpNewSessionResult,
  AcpPermissionOutcome,
  AcpTerminalOutputResult,
  AcpUiEvent,
} from '../../../shared/acp-types.js';
import type { McpManager } from '../mcp-manager.js';
import { AcpAgentConnection } from './acp-connection.js';
import { loadAgentsConfig, saveAgentsConfig } from './agents-config.js';
import { startConfigBridge, type ConfigBridge } from './config-bridge.js';
import { PermissionBroker } from './permission-broker.js';

export class AcpManager {
  private agents: Record<string, AcpAgentConfig>;
  private connections = new Map<string, AcpAgentConnection>();
  private sessionToAgent = new Map<string, string>();
  private statuses = new Map<string, AcpAgentStatus>();
  private mainWindow: BrowserWindow | null = null;
  private broker: PermissionBroker;
  private configBridge: ConfigBridge | null = null;
  private configBridgeFailed = false;

  constructor(private getMcpManager: () => McpManager | null) {
    this.agents = loadAgentsConfig();
    this.broker = new PermissionBroker(
      (payload) => this.send(ACP_PERMISSION_REQUEST, payload),
      (sessionId, requestId) =>
        this.emitSessionEvent(sessionId, { type: 'permission_resolved', requestId })
    );
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
    // Pending permission cards die with the renderer; resolve them as cancelled
    window.webContents.once('destroyed', () => {
      if (this.mainWindow === window) {
        this.broker.cancelAll();
        this.mainWindow = null;
      }
    });
  }

  private send(channel: string, payload: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
  }

  private emitSessionEvent(sessionId: string, event: AcpUiEvent): void {
    this.send(ACP_SESSION_UPDATE, { sessionId, event });
  }

  // ============================================
  // Registry
  // ============================================

  getAgents(): AcpAgentInfo[] {
    return Object.entries(this.agents).map(([id, config]) => ({
      ...config,
      id,
      status: this.statuses.get(id) ?? 'idle',
    }));
  }

  addAgent(id: string, config: AcpAgentConfig): void {
    if (this.agents[id]) {
      throw new Error(`Agent "${id}" already exists`);
    }
    this.agents[id] = { ...config, builtIn: false };
    saveAgentsConfig(this.agents);
  }

  updateAgent(id: string, updates: Partial<AcpAgentConfig>): void {
    const existing = this.agents[id];
    if (!existing) {
      throw new Error(`Unknown agent: ${id}`);
    }
    this.agents[id] = { ...existing, ...updates, builtIn: existing.builtIn };
    saveAgentsConfig(this.agents);
  }

  removeAgent(id: string): void {
    const existing = this.agents[id];
    if (!existing) return;
    if (existing.builtIn) {
      throw new Error('Built-in agents cannot be removed (disable them instead)');
    }
    this.stopAgent(id);
    delete this.agents[id];
    saveAgentsConfig(this.agents);
  }

  stopAgent(id: string): void {
    const connection = this.connections.get(id);
    if (connection) {
      connection.stop();
      this.connections.delete(id);
      for (const [sessionId, agentId] of [...this.sessionToAgent]) {
        if (agentId === id) this.sessionToAgent.delete(sessionId);
      }
    }
  }

  // ============================================
  // Sessions
  // ============================================

  async newSession(agentId: string, cwd: string): Promise<AcpNewSessionResult> {
    const config = this.agents[agentId];
    if (!config) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    if (!config.enabled) {
      throw new Error(`Agent "${config.displayName}" is disabled`);
    }
    if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error(`Working directory does not exist: ${cwd}`);
    }

    let connection = this.connections.get(agentId);
    if (!connection || !connection.isAlive) {
      connection = new AcpAgentConnection(agentId, config, this.broker, {
        onSessionEvent: (sessionId, event) => {
          this.emitSessionEvent(sessionId, event);
          if (event.type === 'session_dead') {
            this.sessionToAgent.delete(sessionId);
          }
        },
        onStatusChanged: (status, error, stderrTail) => {
          this.statuses.set(agentId, status);
          this.send(ACP_AGENT_STATUS_CHANGED, { agentId, status, error, stderrTail });
        },
      });
      this.connections.set(agentId, connection);
    }

    // Start (or confirm) the agent before assembling the server list so we
    // can read its negotiated capabilities
    if (!connection.isAlive) {
      await connection.start();
    }

    const mcpServers = await this.buildMcpPassthrough();

    // Give the agent Skilljack's own server-config tools via the HTTP bridge
    if (connection.supportsHttpMcp) {
      const bridge = await this.ensureConfigBridge();
      if (bridge) {
        mcpServers.push({
          type: 'http',
          name: 'skilljack',
          url: bridge.url,
          headers: [{ name: 'Authorization', value: `Bearer ${bridge.authToken}` }],
        });
      }
    } else {
      log.info('[ACP] Agent does not support http MCP servers; skipping config bridge');
    }

    const result = await connection.newSession(cwd, mcpServers);
    this.sessionToAgent.set(result.sessionId, agentId);

    // Remember the cwd as the default for this agent's next session
    if (config.defaultSessionCwd !== cwd) {
      this.updateAgent(agentId, { defaultSessionCwd: cwd });
    }

    return result;
  }

  /**
   * Forward Skilljack's enabled stdio MCP servers into the agent's session.
   * Strictly follows the enabled toggle: a disabled server keeps running in
   * the app (its tools are just hidden from the built-in models), but it is
   * not offered to agents — matching what the config UI toggle says.
   */
  private async buildMcpPassthrough(): Promise<McpServer[]> {
    try {
      const mcpManager = this.getMcpManager();
      if (!mcpManager) return [];
      const configs = await mcpManager.getServerConfigs();
      const servers = configs
        .filter((server) => server.transport === 'stdio' && server.command && server.enabled)
        .map((server) => ({
          name: server.name,
          command: server.command,
          args: server.args ?? [],
          env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
        }));
      log.info(
        `[ACP] Forwarding ${servers.length} MCP server(s) to agent session: ` +
          (servers.map((s) => s.name).join(', ') || '(none)')
      );
      return servers;
    } catch (err) {
      log.warn('[ACP] Failed to build MCP passthrough list:', err);
      return [];
    }
  }

  /** Start the config bridge lazily; don't retry every session if it fails */
  private async ensureConfigBridge(): Promise<ConfigBridge | null> {
    if (this.configBridge) return this.configBridge;
    if (this.configBridgeFailed) return null;
    try {
      this.configBridge = await startConfigBridge({
        getMcpManager: this.getMcpManager,
        openApp: (payload) => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.send(ACP_OPEN_APP, payload);
            return true;
          }
          return false;
        },
      });
      return this.configBridge;
    } catch (err) {
      this.configBridgeFailed = true;
      log.warn('[ACP] Failed to start config bridge, agents will not get server-config tools:', err);
      return null;
    }
  }

  prompt(sessionId: string, text: string): string {
    return this.requireConnectionForSession(sessionId).prompt(sessionId, text);
  }

  async cancel(sessionId: string): Promise<void> {
    await this.requireConnectionForSession(sessionId).cancel(sessionId);
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.requireConnectionForSession(sessionId).setMode(sessionId, modeId);
  }

  async setConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<void> {
    await this.requireConnectionForSession(sessionId).setConfigOption(sessionId, configId, value);
  }

  respondPermission(requestId: string, outcome: AcpPermissionOutcome): void {
    this.broker.respond(requestId, outcome);
  }

  getTerminalOutput(sessionId: string, terminalId: string): AcpTerminalOutputResult {
    return this.requireConnectionForSession(sessionId).getTerminalOutput(terminalId);
  }

  // ============================================
  // Shutdown
  // ============================================

  shutdown(): void {
    this.broker.cancelAll();
    for (const connection of this.connections.values()) {
      connection.stop();
    }
    this.connections.clear();
    this.sessionToAgent.clear();
    if (this.configBridge) {
      void this.configBridge.close();
      this.configBridge = null;
    }
  }

  private requireConnectionForSession(sessionId: string): AcpAgentConnection {
    const agentId = this.sessionToAgent.get(sessionId);
    const connection = agentId ? this.connections.get(agentId) : undefined;
    if (!connection) {
      throw new Error(`No active agent for session: ${sessionId}`);
    }
    return connection;
  }
}
