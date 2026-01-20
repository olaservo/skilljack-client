/**
 * Main server manager for MCP servers
 */

import { EventEmitter } from 'node:events';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  ManagerConfig,
  ServerConfig,
  LifecycleConfig,
} from '../types/config.js';
import type { ServerStateSummary, ServerStatus } from '../types/state.js';
import type {
  LifecycleEvent,
  LifecycleEventMap,
  LifecycleEventType,
  ManagerEvent,
  ManagerEventMap,
  ManagerEventType,
} from '../types/events.js';
import { ServerLifecycle } from '../core/server-lifecycle.js';
import { ConfigLoader } from './config-loader.js';
import { createLogger, type Logger, type LoggerFactory } from '../utils/logger.js';

/**
 * Options for ServerManager construction
 */
export interface ServerManagerOptions {
  /** Optional logger factory for custom logging */
  loggerFactory?: LoggerFactory;
  /** Whether to auto-start servers marked with autoStart: true (default: true) */
  autoStart?: boolean;
}

/**
 * Combined event map for the manager
 */
export type AllEventMap = LifecycleEventMap & ManagerEventMap;
export type AllEventType = LifecycleEventType | ManagerEventType;

/**
 * Main class for managing multiple MCP servers
 */
export class ServerManager extends EventEmitter {
  private config: ManagerConfig;
  private servers: Map<string, ServerLifecycle> = new Map();
  private logger: Logger;
  private loggerFactory?: LoggerFactory;
  private started = false;
  private shuttingDown = false;

  constructor(config: ManagerConfig, options?: ServerManagerOptions) {
    super();
    this.config = config;
    this.loggerFactory = options?.loggerFactory;
    this.logger = options?.loggerFactory?.createLogger('ServerManager') ??
      createLogger('ServerManager');

    // Initialize server lifecycles
    this.initializeServers();
  }

  /**
   * Creates a ServerManager from a configuration file
   */
  static async fromConfigFile(
    filePath: string,
    options?: ServerManagerOptions
  ): Promise<ServerManager> {
    const loader = new ConfigLoader();
    const config = await loader.loadFromFile(filePath);
    return new ServerManager(config, options);
  }

  /**
   * Creates a ServerManager from a configuration object
   */
  static fromConfig(
    config: unknown,
    options?: ServerManagerOptions
  ): ServerManager {
    const loader = new ConfigLoader();
    const validatedConfig = loader.loadFromObject(config);
    return new ServerManager(validatedConfig, options);
  }

  /**
   * Initializes server lifecycle instances
   */
  private initializeServers(): void {
    for (const serverConfig of this.config.servers) {
      const lifecycle = new ServerLifecycle(
        serverConfig,
        this.config.defaults,
        this.loggerFactory?.createLogger(`Server:${serverConfig.name}`)
      );

      // Forward all events
      lifecycle.on('*', (event: LifecycleEvent) => {
        this.emit(event.type, event);
        this.emit('*', event);
      });

      this.servers.set(serverConfig.name, lifecycle);
    }

    this.logger.info('Initialized servers', {
      count: this.servers.size,
      names: Array.from(this.servers.keys()),
    });
  }

  /**
   * Starts all servers configured for auto-start
   */
  async start(): Promise<void> {
    if (this.started) {
      this.logger.warn('Manager already started');
      return;
    }

    this.logger.info('Starting server manager');
    this.started = true;

    const autoStartServers = this.config.servers.filter(
      (s) => s.autoStart !== false
    );

    if (autoStartServers.length === 0) {
      this.logger.info('No servers configured for auto-start');
    } else {
      this.logger.info('Auto-starting servers', {
        count: autoStartServers.length,
        names: autoStartServers.map((s) => s.name),
      });

      // Start servers in parallel
      await Promise.allSettled(
        autoStartServers.map((serverConfig) =>
          this.startServer(serverConfig.name)
        )
      );
    }

    this.emitManagerEvent({
      type: 'manager:ready',
      timestamp: new Date(),
      serverCount: this.servers.size,
    });
  }

  /**
   * Stops all servers gracefully
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      this.logger.warn('Shutdown already in progress');
      return;
    }

    this.shuttingDown = true;
    this.logger.info('Shutting down server manager');

    // Stop all servers in parallel
    const stopPromises = Array.from(this.servers.values()).map((lifecycle) =>
      lifecycle.stop().catch((error) => {
        this.logger.error('Error stopping server', {
          name: lifecycle.name,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );

    await Promise.allSettled(stopPromises);

    this.started = false;
    this.shuttingDown = false;

    this.emitManagerEvent({
      type: 'manager:shutdown',
      timestamp: new Date(),
      graceful: true,
    });

    this.logger.info('Server manager shutdown complete');
  }

  /**
   * Starts a specific server by name
   */
  async startServer(name: string): Promise<void> {
    const lifecycle = this.servers.get(name);
    if (!lifecycle) {
      throw new Error(`Server not found: ${name}`);
    }

    this.logger.info('Starting server', { name });
    await lifecycle.start();
  }

  /**
   * Stops a specific server by name
   */
  async stopServer(name: string): Promise<void> {
    const lifecycle = this.servers.get(name);
    if (!lifecycle) {
      throw new Error(`Server not found: ${name}`);
    }

    this.logger.info('Stopping server', { name });
    await lifecycle.stop();
  }

  /**
   * Restarts a specific server by name
   */
  async restartServer(name: string): Promise<void> {
    const lifecycle = this.servers.get(name);
    if (!lifecycle) {
      throw new Error(`Server not found: ${name}`);
    }

    this.logger.info('Restarting server', { name });
    await lifecycle.restart();
  }

  /**
   * Gets the status of a specific server
   */
  getServerStatus(name: string): ServerStatus | undefined {
    return this.servers.get(name)?.getStatus();
  }

  /**
   * Gets the state summary for a specific server
   */
  getServerState(name: string): ServerStateSummary | undefined {
    return this.servers.get(name)?.getStateSummary();
  }

  /**
   * Gets state summaries for all servers
   */
  getAllServerStates(): ServerStateSummary[] {
    return Array.from(this.servers.values()).map((lifecycle) =>
      lifecycle.getStateSummary()
    );
  }

  /**
   * Gets the MCP client for a specific server
   */
  getClient(name: string): Client | null {
    return this.servers.get(name)?.getClient() ?? null;
  }

  /**
   * Gets all connected MCP clients
   */
  getConnectedClients(): Map<string, Client> {
    const clients = new Map<string, Client>();
    for (const [name, lifecycle] of this.servers) {
      const client = lifecycle.getClient();
      if (client) {
        clients.set(name, client);
      }
    }
    return clients;
  }

  /**
   * Checks if a server is connected
   */
  isServerConnected(name: string): boolean {
    return this.servers.get(name)?.getStatus() === 'connected';
  }

  /**
   * Checks if all servers are connected
   */
  areAllServersConnected(): boolean {
    return Array.from(this.servers.values()).every(
      (lifecycle) => lifecycle.getStatus() === 'connected'
    );
  }

  /**
   * Gets the list of server names
   */
  getServerNames(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Gets the number of managed servers
   */
  getServerCount(): number {
    return this.servers.size;
  }

  /**
   * Adds a new server dynamically
   */
  addServer(config: ServerConfig): void {
    if (this.servers.has(config.name)) {
      throw new Error(`Server already exists: ${config.name}`);
    }

    const lifecycle = new ServerLifecycle(
      config,
      this.config.defaults,
      this.loggerFactory?.createLogger(`Server:${config.name}`)
    );

    // Forward all events
    lifecycle.on('*', (event: LifecycleEvent) => {
      this.emit(event.type, event);
      this.emit('*', event);
    });

    this.servers.set(config.name, lifecycle);
    this.config.servers.push(config);

    this.logger.info('Added new server', { name: config.name });
  }

  /**
   * Removes a server (must be stopped first)
   */
  async removeServer(name: string): Promise<void> {
    const lifecycle = this.servers.get(name);
    if (!lifecycle) {
      throw new Error(`Server not found: ${name}`);
    }

    if (lifecycle.getStatus() !== 'stopped' && lifecycle.getStatus() !== 'disconnected') {
      await lifecycle.stop();
    }

    this.servers.delete(name);
    this.config.servers = this.config.servers.filter((s) => s.name !== name);

    this.logger.info('Removed server', { name });
  }

  /**
   * Emits a state snapshot event with current states of all servers
   */
  emitStateSnapshot(): void {
    this.emitManagerEvent({
      type: 'manager:state-snapshot',
      timestamp: new Date(),
      servers: this.getAllServerStates(),
    });
  }

  /**
   * Emits a manager event
   */
  private emitManagerEvent<T extends keyof ManagerEventMap>(
    event: ManagerEventMap[T]
  ): void {
    this.emit(event.type, event);
    this.emit('manager:*', event);
  }

  /**
   * Adds an event listener for lifecycle events.
   */
  onLifecycleEvent<T extends LifecycleEventType>(
    event: T,
    listener: (e: LifecycleEventMap[T]) => void
  ): this {
    return super.on(event, listener);
  }

  /**
   * Adds an event listener for manager events.
   */
  onManagerEvent<T extends ManagerEventType>(
    event: T,
    listener: (e: ManagerEventMap[T]) => void
  ): this {
    return super.on(event, listener);
  }

  /**
   * Adds a listener for all lifecycle events.
   */
  onAnyLifecycleEvent(listener: (e: LifecycleEvent) => void): this {
    return super.on('*', listener);
  }

  /**
   * Adds a listener for all manager events.
   */
  onAnyManagerEvent(listener: (e: ManagerEvent) => void): this {
    return super.on('manager:*', listener);
  }

  /**
   * Adds a one-time event listener for lifecycle events.
   */
  onceLifecycleEvent<T extends LifecycleEventType>(
    event: T,
    listener: (e: LifecycleEventMap[T]) => void
  ): this {
    return super.once(event, listener);
  }

  /**
   * Adds a one-time event listener for manager events.
   */
  onceManagerEvent<T extends ManagerEventType>(
    event: T,
    listener: (e: ManagerEventMap[T]) => void
  ): this {
    return super.once(event, listener);
  }
}
