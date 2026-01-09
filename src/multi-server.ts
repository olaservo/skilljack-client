/**
 * Multi-Server Module - Connect to multiple MCP servers simultaneously
 *
 * This module is standalone. Copy this file to add multi-server support to any MCP client.
 *
 * Usage:
 *   import {
 *     loadMultiServerConfig,
 *     connectToAllServers,
 *     aggregateTools,
 *     findServerForTool,
 *     callToolAcrossServers,
 *   } from './multi-server.js';
 *
 *   const config = await loadMultiServerConfig('./servers.json');
 *   const clients = await connectToAllServers(config);
 *
 *   // Get all tools from all servers
 *   const tools = await aggregateTools(clients);
 *
 *   // Call a tool (finds the right server automatically)
 *   const result = await callToolAcrossServers(clients, 'tool-name', { arg: 'value' });
 *
 *   // Clean up
 *   await disconnectAll(clients);
 *
 * Config file format (servers.json):
 *   {
 *     "mcpServers": {
 *       "server-name": {
 *         "transport": "stdio",
 *         "command": "node",
 *         "args": ["server.js"],
 *         "env": { "KEY": "value" }
 *       },
 *       "remote-server": {
 *         "transport": "http",
 *         "url": "http://localhost:3000/mcp",
 *         "headers": { "Authorization": "Bearer token" }
 *       }
 *     }
 *   }
 */

import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool, Prompt, Resource } from '@modelcontextprotocol/sdk/types.js';
import { createStdioTransport } from './transports/stdio.js';
import { createHttpTransport } from './transports/http.js';
import { log, logError, logWarn } from './logging.js';

// ============================================================================
// TYPES
// ============================================================================

export interface StdioServerConfig {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpServerConfig {
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
}

export type ServerConnectionConfig = StdioServerConfig | HttpServerConfig;

export interface MultiServerConfig {
  /** Server configurations keyed by name */
  mcpServers: Record<string, ServerConnectionConfig>;
}

/** Tool with server origin attached */
export interface AggregatedTool extends Tool {
  serverName: string;
}

/** Prompt with server origin attached */
export interface AggregatedPrompt extends Prompt {
  serverName: string;
}

/** Resource with server origin attached */
export interface AggregatedResource extends Resource {
  serverName: string;
}

/** Connection result for a single server */
export interface ConnectionResult {
  name: string;
  client: Client | null;
  error?: Error;
}

/** Options for connecting to servers */
export interface ConnectOptions {
  /** Client capabilities to declare */
  capabilities?: Record<string, unknown>;
  /** Continue connecting even if some servers fail */
  continueOnError?: boolean;
  /** Callback when a server connects successfully */
  onConnect?: (name: string, client: Client) => void;
  /** Callback when a server fails to connect */
  onError?: (name: string, error: Error) => void;
}

// ============================================================================
// CONFIG LOADING
// ============================================================================

/**
 * Load multi-server configuration from a JSON file.
 *
 * @param path - Path to the config file
 * @returns Parsed configuration
 * @throws Error if file not found or invalid JSON
 */
export async function loadMultiServerConfig(path: string): Promise<MultiServerConfig> {
  const content = await readFile(path, 'utf-8');
  const config = JSON.parse(content) as MultiServerConfig;

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    throw new Error('Config missing required field: mcpServers');
  }

  // Validate each server config
  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    if (!serverConfig.transport) {
      throw new Error(`Server "${name}" missing required field: transport`);
    }

    if (serverConfig.transport === 'stdio' && !serverConfig.command) {
      throw new Error(`Server "${name}" (stdio) missing required field: command`);
    }

    if (serverConfig.transport === 'http' && !serverConfig.url) {
      throw new Error(`Server "${name}" (http) missing required field: url`);
    }
  }

  return config;
}

// ============================================================================
// CONNECTION MANAGEMENT
// ============================================================================

/**
 * Connect to a single MCP server based on its configuration.
 *
 * @param name - Server name (for logging)
 * @param config - Server connection configuration
 * @param capabilities - Client capabilities to declare
 * @returns Connected Client instance
 */
export async function connectToServer(
  name: string,
  config: ServerConnectionConfig,
  capabilities?: Record<string, unknown>
): Promise<Client> {
  const transport =
    config.transport === 'stdio'
      ? createStdioTransport(config.command, config.args, config.env)
      : createHttpTransport(config.url, config.headers);

  const client = new Client(
    { name: `skilljack-client-${name}`, version: '0.1.0' },
    { capabilities }
  );

  await client.connect(transport);
  return client;
}

/**
 * Connect to all servers defined in configuration.
 *
 * Connections are made in parallel for speed. By default, throws on first error.
 * Use `continueOnError: true` to connect to as many servers as possible.
 *
 * @param config - Multi-server configuration
 * @param options - Connection options
 * @returns Map of server name to connected Client
 */
export async function connectToAllServers(
  config: MultiServerConfig,
  options: ConnectOptions = {}
): Promise<Map<string, Client>> {
  const { capabilities, continueOnError = false, onConnect, onError } = options;
  const entries = Object.entries(config.mcpServers);

  log(`Connecting to ${entries.length} server(s)...`);

  // Connect in parallel
  const results = await Promise.allSettled(
    entries.map(async ([name, serverConfig]): Promise<ConnectionResult> => {
      try {
        const client = await connectToServer(name, serverConfig, capabilities);
        onConnect?.(name, client);
        return { name, client };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        onError?.(name, err);
        return { name, client: null, error: err };
      }
    })
  );

  const clients = new Map<string, Client>();
  const failures: Array<{ name: string; error: Error }> = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { name, client, error } = result.value;
      if (client) {
        clients.set(name, client);
        log(`  Connected: ${name}`);
      } else if (error) {
        failures.push({ name, error });
        logWarn(`  Failed: ${name} - ${error.message}`);
      }
    } else {
      // Promise.allSettled shouldn't reject, but handle just in case
      logError(`  Unexpected error:`, result.reason);
    }
  }

  // Throw if any failed and we're not continuing on error
  if (failures.length > 0 && !continueOnError) {
    // Clean up successful connections before throwing
    await disconnectAll(clients);
    const names = failures.map((f) => f.name).join(', ');
    throw new Error(`Failed to connect to server(s): ${names}`);
  }

  log(`Connected to ${clients.size}/${entries.length} server(s)`);
  return clients;
}

/**
 * Disconnect from all servers gracefully.
 *
 * @param clients - Map of connected clients
 */
export async function disconnectAll(clients: Map<string, Client>): Promise<void> {
  const closePromises = Array.from(clients.entries()).map(async ([name, client]) => {
    try {
      await client.close();
    } catch (error) {
      logWarn(`Warning during cleanup of ${name}:`, error);
    }
  });

  await Promise.allSettled(closePromises);
  clients.clear();
}

// ============================================================================
// AGGREGATION
// ============================================================================

/**
 * Get all tools from all connected servers.
 *
 * Each tool includes a `serverName` property indicating its origin.
 *
 * @param clients - Map of connected clients
 * @returns Array of tools with server names attached
 */
export async function aggregateTools(clients: Map<string, Client>): Promise<AggregatedTool[]> {
  const allTools: AggregatedTool[] = [];

  const results = await Promise.allSettled(
    Array.from(clients.entries()).map(async ([serverName, client]) => {
      const response = await client.listTools();
      return response.tools.map((tool) => ({ ...tool, serverName }));
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allTools.push(...result.value);
    }
  }

  return allTools;
}

/**
 * Get all prompts from all connected servers.
 *
 * @param clients - Map of connected clients
 * @returns Array of prompts with server names attached
 */
export async function aggregatePrompts(clients: Map<string, Client>): Promise<AggregatedPrompt[]> {
  const allPrompts: AggregatedPrompt[] = [];

  const results = await Promise.allSettled(
    Array.from(clients.entries()).map(async ([serverName, client]) => {
      const response = await client.listPrompts();
      return response.prompts.map((prompt) => ({ ...prompt, serverName }));
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allPrompts.push(...result.value);
    }
  }

  return allPrompts;
}

/**
 * Get all resources from all connected servers.
 *
 * @param clients - Map of connected clients
 * @returns Array of resources with server names attached
 */
export async function aggregateResources(
  clients: Map<string, Client>
): Promise<AggregatedResource[]> {
  const allResources: AggregatedResource[] = [];

  const results = await Promise.allSettled(
    Array.from(clients.entries()).map(async ([serverName, client]) => {
      const response = await client.listResources();
      return response.resources.map((resource) => ({ ...resource, serverName }));
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allResources.push(...result.value);
    }
  }

  return allResources;
}

// ============================================================================
// TOOL ROUTING
// ============================================================================

/**
 * Find which server has a specific tool.
 *
 * @param clients - Map of connected clients
 * @param toolName - Name of the tool to find
 * @returns Server name and client, or null if not found
 */
export async function findServerForTool(
  clients: Map<string, Client>,
  toolName: string
): Promise<{ serverName: string; client: Client } | null> {
  // Check servers in parallel
  const results = await Promise.allSettled(
    Array.from(clients.entries()).map(async ([serverName, client]) => {
      const response = await client.listTools();
      const hasTool = response.tools.some((t) => t.name === toolName);
      return hasTool ? { serverName, client } : null;
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      return result.value;
    }
  }

  return null;
}

/**
 * Call a tool, automatically routing to the correct server.
 *
 * @param clients - Map of connected clients
 * @param toolName - Name of the tool to call
 * @param args - Tool arguments
 * @returns Tool result
 * @throws Error if tool not found on any server
 */
export async function callToolAcrossServers(
  clients: Map<string, Client>,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<{ serverName: string; result: Awaited<ReturnType<Client['callTool']>> }> {
  const server = await findServerForTool(clients, toolName);

  if (!server) {
    throw new Error(`Tool "${toolName}" not found on any connected server`);
  }

  const result = await server.client.callTool({ name: toolName, arguments: args });
  return { serverName: server.serverName, result };
}

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Get a summary of all connected servers and their capabilities.
 *
 * @param clients - Map of connected clients
 * @returns Summary object with server info
 */
export async function getServersSummary(clients: Map<string, Client>): Promise<
  Array<{
    name: string;
    serverVersion: ReturnType<Client['getServerVersion']>;
    toolCount: number;
    promptCount: number;
    resourceCount: number;
  }>
> {
  const summaries = await Promise.all(
    Array.from(clients.entries()).map(async ([name, client]) => {
      const [tools, prompts, resources] = await Promise.allSettled([
        client.listTools(),
        client.listPrompts(),
        client.listResources(),
      ]);

      return {
        name,
        serverVersion: client.getServerVersion(),
        toolCount: tools.status === 'fulfilled' ? tools.value.tools.length : 0,
        promptCount: prompts.status === 'fulfilled' ? prompts.value.prompts.length : 0,
        resourceCount: resources.status === 'fulfilled' ? resources.value.resources.length : 0,
      };
    })
  );

  return summaries;
}

// ============================================================================
// CAPABILITY SETUP - Server-Aware Wrappers
// ============================================================================

// Import capability modules
import { setupSampling, type SamplingConfig, type SamplingRequest, type SamplingResponse } from './capabilities/sampling.js';
import { setupElicitation, type ElicitationConfig, type ElicitationResult } from './capabilities/elicitation.js';
import { setupRoots } from './capabilities/roots.js';
import { setupLogging, type LoggingLevel } from './capabilities/logging.js';
import { setupListChanged, type ListChangedCallbacks } from './capabilities/list-changed.js';
import { setupSubscriptions } from './capabilities/subscriptions.js';

/**
 * Server-aware sampling callbacks.
 * Each callback receives the server name as the first argument.
 */
export interface MultiServerSamplingCallbacks {
  onApprovalRequest?: (serverName: string, request: SamplingRequest) => Promise<boolean>;
  onResponse?: (serverName: string, response: SamplingResponse) => void;
  onLog?: (serverName: string, message: string) => void;
}

export interface MultiServerSamplingConfig extends Omit<SamplingConfig, 'onApprovalRequest' | 'onResponse' | 'onLog'> {
  callbacks?: MultiServerSamplingCallbacks;
}

/**
 * Set up sampling capability on all clients.
 *
 * Callbacks include the server name so you know which server is making the request.
 *
 * @param clients - Map of connected clients
 * @param config - Sampling configuration with server-aware callbacks
 */
export function setupSamplingForAll(
  clients: Map<string, Client>,
  config: MultiServerSamplingConfig = {}
): void {
  const { callbacks, ...baseConfig } = config;

  for (const [serverName, client] of clients.entries()) {
    setupSampling(client, {
      ...baseConfig,
      onApprovalRequest: callbacks?.onApprovalRequest
        ? (request) => callbacks.onApprovalRequest!(serverName, request)
        : undefined,
      onResponse: callbacks?.onResponse
        ? (response) => callbacks.onResponse!(serverName, response)
        : undefined,
      onLog: callbacks?.onLog
        ? (message) => callbacks.onLog!(serverName, message)
        : undefined,
    });
  }
}

/**
 * Server-aware elicitation callbacks.
 */
export interface MultiServerElicitationConfig {
  onForm?: (serverName: string, message: string, schema?: Record<string, unknown>) => Promise<ElicitationResult>;
  onUrl?: (serverName: string, url: string, message: string) => Promise<ElicitationResult>;
}

/**
 * Set up elicitation capability on all clients.
 *
 * @param clients - Map of connected clients
 * @param config - Elicitation configuration with server-aware callbacks
 */
export function setupElicitationForAll(
  clients: Map<string, Client>,
  config: MultiServerElicitationConfig = {}
): void {
  for (const [serverName, client] of clients.entries()) {
    const elicitConfig: ElicitationConfig = {};

    if (config.onForm) {
      elicitConfig.onForm = (message, schema) => config.onForm!(serverName, message, schema);
    }
    if (config.onUrl) {
      elicitConfig.onUrl = (url, message) => config.onUrl!(serverName, url, message);
    }

    setupElicitation(client, elicitConfig);
  }
}

/**
 * Set up roots capability on all clients.
 *
 * All servers see the same roots (shared filesystem view).
 *
 * @param clients - Map of connected clients
 * @param paths - Filesystem paths to expose
 */
export function setupRootsForAll(clients: Map<string, Client>, paths: string[]): void {
  for (const client of clients.values()) {
    setupRoots(client, paths);
  }
}

/**
 * Server-aware logging callback.
 */
export type MultiServerLogCallback = (
  serverName: string,
  level: LoggingLevel,
  logger: string | undefined,
  data: unknown
) => void;

/**
 * Set up logging capability on all clients.
 *
 * @param clients - Map of connected clients
 * @param onLogMessage - Callback with server name included
 */
export function setupLoggingForAll(
  clients: Map<string, Client>,
  onLogMessage: MultiServerLogCallback
): void {
  for (const [serverName, client] of clients.entries()) {
    setupLogging(client, (level, logger, data) => {
      onLogMessage(serverName, level, logger, data);
    });
  }
}

/**
 * Server-aware list changed callbacks.
 */
export interface MultiServerListChangedCallbacks {
  onToolsChanged?: (serverName: string, tools: Tool[]) => void;
  onPromptsChanged?: (serverName: string, prompts: Prompt[]) => void;
  onResourcesChanged?: (serverName: string, resources: Resource[]) => void;
}

/**
 * Set up list changed notifications on all clients.
 *
 * @param clients - Map of connected clients
 * @param callbacks - Callbacks with server name included
 */
export function setupListChangedForAll(
  clients: Map<string, Client>,
  callbacks: MultiServerListChangedCallbacks
): void {
  for (const [serverName, client] of clients.entries()) {
    const clientCallbacks: ListChangedCallbacks = {};

    if (callbacks.onToolsChanged) {
      clientCallbacks.onToolsChanged = (tools) => callbacks.onToolsChanged!(serverName, tools);
    }
    if (callbacks.onPromptsChanged) {
      clientCallbacks.onPromptsChanged = (prompts) => callbacks.onPromptsChanged!(serverName, prompts);
    }
    if (callbacks.onResourcesChanged) {
      clientCallbacks.onResourcesChanged = (resources) => callbacks.onResourcesChanged!(serverName, resources);
    }

    setupListChanged(client, clientCallbacks);
  }
}

/**
 * Server-aware subscription callback.
 */
export type MultiServerSubscriptionCallback = (serverName: string, uri: string) => void;

/**
 * Set up resource subscription notifications on all clients.
 *
 * @param clients - Map of connected clients
 * @param onResourceUpdated - Callback with server name included
 */
export function setupSubscriptionsForAll(
  clients: Map<string, Client>,
  onResourceUpdated: MultiServerSubscriptionCallback
): void {
  for (const [serverName, client] of clients.entries()) {
    setupSubscriptions(client, (uri) => {
      onResourceUpdated(serverName, uri);
    });
  }
}

// ============================================================================
// ALL-IN-ONE SETUP
// ============================================================================

/**
 * Configuration for setting up all capabilities at once.
 */
export interface MultiServerCapabilitiesConfig {
  /** Sampling configuration */
  sampling?: MultiServerSamplingConfig;
  /** Elicitation configuration */
  elicitation?: MultiServerElicitationConfig;
  /** Filesystem roots to expose */
  roots?: string[];
  /** Logging callback */
  onLogMessage?: MultiServerLogCallback;
  /** List changed callbacks */
  listChanged?: MultiServerListChangedCallbacks;
  /** Subscription update callback */
  onResourceUpdated?: MultiServerSubscriptionCallback;
}

/**
 * Set up all capabilities on all clients at once.
 *
 * This is a convenience function that calls all the individual setup functions.
 *
 * @param clients - Map of connected clients
 * @param config - Configuration for all capabilities
 *
 * @example
 * ```typescript
 * setupAllCapabilities(clients, {
 *   sampling: {
 *     apiKey: process.env.ANTHROPIC_API_KEY,
 *     callbacks: {
 *       onApprovalRequest: async (server, req) => {
 *         console.log(`[${server}] Sampling request:`, req);
 *         return true;
 *       },
 *     },
 *   },
 *   roots: ['/workspace'],
 *   onLogMessage: (server, level, logger, data) => {
 *     console.log(`[${server}][${level}] ${logger}:`, data);
 *   },
 * });
 * ```
 */
export function setupAllCapabilities(
  clients: Map<string, Client>,
  config: MultiServerCapabilitiesConfig
): void {
  if (config.sampling) {
    setupSamplingForAll(clients, config.sampling);
  }

  if (config.elicitation) {
    setupElicitationForAll(clients, config.elicitation);
  }

  if (config.roots && config.roots.length > 0) {
    setupRootsForAll(clients, config.roots);
  }

  if (config.onLogMessage) {
    setupLoggingForAll(clients, config.onLogMessage);
  }

  if (config.listChanged) {
    setupListChangedForAll(clients, config.listChanged);
  }

  if (config.onResourceUpdated) {
    setupSubscriptionsForAll(clients, config.onResourceUpdated);
  }
}
