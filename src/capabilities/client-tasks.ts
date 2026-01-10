/**
 * Client-Side Task Hooks - Optional logging for client-side task execution
 *
 * The SDK automatically handles task requests (tasks/get, tasks/result, tasks/list, tasks/cancel)
 * when a taskStore is provided to the Client constructor. This module provides optional
 * logging hooks to observe task activity.
 *
 * Note: The SDK's InMemoryTaskStore and Protocol class handle all the core functionality.
 * This module is purely for observability and can be removed if logging is not needed.
 *
 * Usage:
 *   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *   import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js';
 *   import { setupClientTasks } from './capabilities/client-tasks.js';
 *
 *   const taskStore = new InMemoryTaskStore();
 *   const client = new Client(
 *     { name: 'my-client', version: '1.0.0' },
 *     {
 *       capabilities: {
 *         tasks: {
 *           list: {},
 *           cancel: {},
 *           requests: {
 *             sampling: { createMessage: {} },
 *             elicitation: { create: {} }
 *           }
 *         }
 *       },
 *       taskStore: taskStore  // SDK automatically handles task requests
 *     }
 *   );
 *
 *   // Optional: add logging
 *   setupClientTasks(client, { onLog: (msg) => console.log(msg) });
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for client-side task logging.
 */
export interface ClientTasksConfig {
  /** Log callback for status messages */
  onLog?: (message: string) => void;
}

// ============================================================================
// SETUP FUNCTION
// ============================================================================

/**
 * Set up optional logging for client-side task management.
 *
 * Note: The SDK automatically handles task requests when taskStore is provided
 * to the Client constructor. This function is only for adding custom logging
 * or other observability hooks.
 *
 * @param client - The MCP client (must have taskStore configured)
 * @param config - Optional configuration
 */
export function setupClientTasks(
  client: Client,
  config: ClientTasksConfig = {}
): void {
  const log = config.onLog ?? (() => {});

  // Log that task support is enabled
  log('[Client Tasks] Task handlers registered by SDK (taskStore configured)');

  // Note: The SDK's Protocol class automatically registers handlers for:
  // - tasks/get: Returns task status from taskStore
  // - tasks/result: Returns task result from taskStore
  // - tasks/list: Lists tasks from taskStore
  // - tasks/cancel: Cancels task in taskStore
  //
  // The sampling.ts and elicitation.ts handlers use extra.taskStore to:
  // - Create tasks via taskStore.createTask()
  // - Update status via taskStore.updateTaskStatus()
  // - Store results via taskStore.storeTaskResult()
  //
  // No additional setup is needed here.
}
