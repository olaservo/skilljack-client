/**
 * Logging Capability - Receive server log messages with level filtering
 *
 * This module is standalone. Copy this file to add logging support to any MCP client.
 *
 * Usage:
 *   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *   import { setupLogging, setLoggingLevel, LOGGING_LEVELS } from './capabilities/logging.js';
 *
 *   const client = new Client({ name: 'my-client', version: '1.0.0' }, { capabilities: {} });
 *
 *   setupLogging(client, (level, logger, data) => {
 *     console.log(`[${level}] ${logger}:`, data);
 *   });
 *
 *   await client.connect(transport);
 *
 *   // Set the logging level (server will only send messages at or above this level)
 *   await setLoggingLevel(client, 'warning');
 *
 *   // Available levels (in order of severity):
 *   // debug < info < notice < warning < error < critical < alert < emergency
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  LoggingMessageNotificationSchema,
  type LoggingLevel,
} from '@modelcontextprotocol/sdk/types.js';

export type { LoggingLevel };

/**
 * Logging levels in order of increasing severity.
 * debug < info < notice < warning < error < critical < alert < emergency
 */
export const LOGGING_LEVELS: readonly LoggingLevel[] = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
] as const;

/**
 * Check if a message level should be logged given the minimum level.
 * Returns true if messageLevel >= minLevel in severity.
 */
export function shouldLog(messageLevel: LoggingLevel, minLevel: LoggingLevel): boolean {
  return LOGGING_LEVELS.indexOf(messageLevel) >= LOGGING_LEVELS.indexOf(minLevel);
}

/**
 * Validate that a string is a valid logging level.
 */
export function isValidLoggingLevel(level: string): level is LoggingLevel {
  return LOGGING_LEVELS.includes(level as LoggingLevel);
}

/**
 * Set up notification handler for server log messages.
 */
export function setupLogging(
  client: Client,
  onLogMessage: (level: LoggingLevel, logger: string | undefined, data: unknown) => void
): void {
  client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
    const { level, logger, data } = notification.params;
    onLogMessage(level, logger, data);
  });
}

/**
 * Check if server supports logging.
 */
export function serverSupportsLogging(client: Client): boolean {
  const caps = client.getServerCapabilities();
  return caps?.logging !== undefined;
}

/**
 * Set the logging level. Server will only send messages at or above this level.
 */
export async function setLoggingLevel(client: Client, level: LoggingLevel): Promise<void> {
  await client.setLoggingLevel(level);
}
