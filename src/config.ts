/**
 * Config Module - Load client configuration from JSON file
 *
 * This module is standalone. Copy this file to add config file support to any MCP client.
 *
 * Usage:
 *   import { loadConfig, getServerInstructions } from './config.js';
 *
 *   const config = loadConfig();  // Auto-detects ./mcp-client.json or ~/.mcp-client.json
 *   const instructions = getServerInstructions(config, 'my-server');
 *
 * Config file format (mcp-client.json):
 *   {
 *     "servers": {
 *       "server-name": {
 *         "instructions": "Custom instructions for this server."
 *       }
 *     }
 *   }
 *
 * Search order:
 *   1. Custom path (if specified)
 *   2. ./mcp-client.json (current directory)
 *   3. ~/.mcp-client.json (home directory)
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { log, logWarn } from './logging.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ServerConfig {
  /** Custom instructions for this server */
  instructions?: string;
}

export interface ClientConfig {
  /** Per-server configuration, keyed by server name */
  servers?: Record<string, ServerConfig>;
}

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Load client configuration from JSON file.
 *
 * Search order:
 *   1. Custom path (if specified)
 *   2. ./mcp-client.json
 *   3. ~/.mcp-client.json
 *
 * Returns empty config if no file found.
 */
export function loadConfig(customPath?: string): ClientConfig {
  const searchPaths = customPath
    ? [resolve(customPath)]
    : [
        join(process.cwd(), 'mcp-client.json'),
        join(homedir(), '.mcp-client.json'),
      ];

  for (const path of searchPaths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        const config = JSON.parse(content) as ClientConfig;
        log(`Loaded config from: ${path}`);
        return config;
      } catch (error) {
        logWarn(`Failed to load config from ${path}:`, error);
      }
    }
  }

  return {};
}

/**
 * Get server-specific instructions from config.
 *
 * Matches by server name (case-insensitive).
 * Returns undefined if no matching config found.
 */
export function getServerInstructions(
  config: ClientConfig,
  serverName: string
): string | undefined {
  if (!config.servers) return undefined;

  // Try exact match first
  if (config.servers[serverName]?.instructions) {
    return config.servers[serverName].instructions;
  }

  // Try case-insensitive match
  const lowerName = serverName.toLowerCase();
  for (const [name, serverConfig] of Object.entries(config.servers)) {
    if (name.toLowerCase() === lowerName && serverConfig.instructions) {
      return serverConfig.instructions;
    }
  }

  return undefined;
}
