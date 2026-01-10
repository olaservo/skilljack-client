/**
 * Tasks Capability - Handle long-running tool operations with progress tracking
 *
 * This module is standalone and UI-agnostic. Copy this file to add task support
 * to any MCP client (CLI, web, desktop, etc.).
 *
 * Usage:
 *   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *   import {
 *     serverSupportsTasks,
 *     callToolWithTaskSupport,
 *     listTasks,
 *     getTask,
 *     cancelTask,
 *   } from './capabilities/tasks.js';
 *
 *   // Check if server supports tasks
 *   if (serverSupportsTasks(client)) {
 *     // Call a tool with task support (streaming progress)
 *     const result = await callToolWithTaskSupport(client, 'my-tool', { arg: 'value' }, {
 *       onTaskCreated: (task) => console.log('Task started:', task.taskId),
 *       onTaskStatusUpdate: (task) => console.log('Status:', task.status, task.statusMessage),
 *     });
 *
 *     // Or manage tasks directly
 *     const tasks = await listTasks(client);
 *     const task = await getTask(client, 'task-id');
 *     await cancelTask(client, 'task-id');
 *   }
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolResultSchema,
  type CallToolResult,
  type Task,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  type ResponseMessage,
  takeResult,
} from '@modelcontextprotocol/sdk/experimental';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Callbacks for task operations.
 * All callbacks are optional - provide the ones you need for your UI.
 */
export interface TaskCallbacks {
  /**
   * Called when a new task is created.
   * Use this to track the task ID and show initial status.
   */
  onTaskCreated?: (task: Task) => void;

  /**
   * Called when task status changes.
   * Use this to show progress updates to the user.
   */
  onTaskStatusUpdate?: (task: Task) => void;

  /**
   * Called for log/status messages.
   * Use this for debug or verbose output.
   */
  onLog?: (message: string) => void;
}

/**
 * Task support level for a tool.
 * - 'required': Tool must be called as a task
 * - 'supported': Tool can optionally be called as a task
 * - 'optional': Same as 'supported' (legacy name)
 * - 'forbidden': Tool cannot be called as a task
 * - undefined: Tool doesn't specify task support
 */
export type TaskSupportLevel = 'required' | 'supported' | 'optional' | 'forbidden' | undefined;

// ============================================================================
// CAPABILITY DETECTION
// ============================================================================

/**
 * Check if the server supports tasks.
 * Returns true if the server declared tasks capability during initialization.
 */
export function serverSupportsTasks(client: Client): boolean {
  const caps = client.getServerCapabilities();
  return caps?.tasks !== undefined;
}

/**
 * Get a tool's task support level from its execution metadata.
 */
export function getToolTaskSupport(tool: Tool): TaskSupportLevel {
  return tool.execution?.taskSupport;
}

/**
 * Check if a tool should use task mode for execution.
 * Returns true if the tool requires or supports tasks AND the server supports tasks.
 */
export function shouldUseTaskMode(client: Client, tool: Tool): boolean {
  if (!serverSupportsTasks(client)) {
    return false;
  }

  const taskSupport = getToolTaskSupport(tool);
  // 'optional' is a legacy name for 'supported'
  return taskSupport === 'required' || taskSupport === 'supported' || taskSupport === 'optional';
}

// ============================================================================
// TASK-ENABLED TOOL CALLING
// ============================================================================

/**
 * Call a tool using the streaming task API.
 *
 * This provides real-time progress updates through the callbacks while
 * the tool executes. The method returns the final result once complete.
 *
 * @param client - The MCP client
 * @param toolName - Name of the tool to call
 * @param args - Arguments to pass to the tool
 * @param callbacks - Optional callbacks for progress updates
 * @returns The final tool result
 * @throws Error if the tool execution fails
 */
export async function callToolWithTaskSupport(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
  callbacks: TaskCallbacks = {}
): Promise<CallToolResult> {
  const { onTaskCreated, onTaskStatusUpdate, onLog } = callbacks;
  const log = onLog ?? (() => {});

  log(`[Tasks] Calling tool "${toolName}" with task support...`);

  // Use the experimental streaming API
  const stream = client.experimental.tasks.callToolStream(
    { name: toolName, arguments: args },
    CallToolResultSchema
  );

  // Process the stream
  for await (const message of stream) {
    switch (message.type) {
      case 'taskCreated':
        log(`[Tasks] Task created: ${message.task.taskId}`);
        onTaskCreated?.(message.task);
        break;

      case 'taskStatus':
        log(`[Tasks] Status: ${message.task.status}${message.task.statusMessage ? ` - ${message.task.statusMessage}` : ''}`);
        onTaskStatusUpdate?.(message.task);
        break;

      case 'result':
        log(`[Tasks] Completed`);
        return message.result;

      case 'error':
        log(`[Tasks] Error: ${message.error.message}`);
        throw message.error;
    }
  }

  // This shouldn't happen as the stream should end with result or error
  throw new Error('Task stream ended unexpectedly without result');
}

/**
 * Call a tool, automatically choosing between task mode and regular mode.
 *
 * Use this when you want the client to intelligently choose the best
 * execution method based on the tool's capabilities.
 *
 * @param client - The MCP client
 * @param tool - The tool definition (from listTools)
 * @param args - Arguments to pass to the tool
 * @param callbacks - Optional callbacks for progress updates (only used in task mode)
 * @returns The final tool result
 */
export async function callToolAuto(
  client: Client,
  tool: Tool,
  args: Record<string, unknown>,
  callbacks: TaskCallbacks = {}
) {
  if (shouldUseTaskMode(client, tool)) {
    return callToolWithTaskSupport(client, tool.name, args, callbacks);
  }

  // Fall back to regular tool call
  return client.callTool({ name: tool.name, arguments: args });
}

// ============================================================================
// TASK MANAGEMENT
// ============================================================================

/**
 * List all tasks known to the server.
 *
 * @param client - The MCP client
 * @param cursor - Optional pagination cursor
 * @returns Array of tasks and optional next cursor
 */
export async function listTasks(
  client: Client,
  cursor?: string
): Promise<{ tasks: Task[]; nextCursor?: string }> {
  const result = await client.experimental.tasks.listTasks(cursor);
  return {
    tasks: result.tasks,
    nextCursor: result.nextCursor,
  };
}

/**
 * Get the current status of a specific task.
 *
 * @param client - The MCP client
 * @param taskId - The task identifier
 * @returns The task object with current status
 */
export async function getTask(client: Client, taskId: string): Promise<Task> {
  const result = await client.experimental.tasks.getTask(taskId);
  return result;
}

/**
 * Cancel a running task.
 *
 * @param client - The MCP client
 * @param taskId - The task identifier
 */
export async function cancelTask(client: Client, taskId: string): Promise<void> {
  await client.experimental.tasks.cancelTask(taskId);
}

// ============================================================================
// DISPLAY HELPERS
// ============================================================================

/**
 * Format a task for display.
 * Returns a human-readable string representation of the task.
 */
export function formatTaskForDisplay(task: Task): string {
  const parts = [
    `Task: ${task.taskId}`,
    `  Status: ${task.status}`,
  ];

  if (task.statusMessage) {
    parts.push(`  Message: ${task.statusMessage}`);
  }

  if (task.pollInterval) {
    parts.push(`  Poll Interval: ${task.pollInterval}ms`);
  }

  if (task.ttl) {
    parts.push(`  TTL: ${task.ttl}ms`);
  }

  return parts.join('\n');
}

/**
 * Format a task status as a single-line summary.
 */
export function formatTaskStatusLine(task: Task): string {
  const status = `[${task.status}]`;
  const message = task.statusMessage ? ` ${task.statusMessage}` : '';
  return `  ${task.taskId} ${status}${message}`;
}

// Re-export types for convenience
export type { Task, CallToolResult };
