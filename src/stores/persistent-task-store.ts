/**
 * Persistent Task Store
 *
 * A TaskStore implementation with optional file-based persistence.
 * Extends the SDK's in-memory behavior with disk storage for resumability.
 *
 * Usage:
 *   import { createPersistentTaskStore } from './stores/persistent-task-store.js';
 *
 *   const taskStore = createPersistentTaskStore({
 *     dataDir: path.join(os.homedir(), '.skilljack', 'data'),
 *     persistenceEnabled: true,
 *   });
 *
 *   const client = new Client(
 *     { name: 'my-client', version: '1.0.0' },
 *     { capabilities, taskStore }
 *   );
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task, RequestId, Result, Request } from '@modelcontextprotocol/sdk/types.js';
import type { TaskStore, CreateTaskOptions } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import { isTerminal } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';

/**
 * Configuration for the persistent task store.
 */
export interface PersistentTaskStoreConfig {
  /** Directory for storing task data. Default: ~/.skilljack/data */
  dataDir?: string;
  /** Enable file persistence. Default: true */
  persistenceEnabled?: boolean;
  /** Callback for logging. */
  onLog?: (msg: string) => void;
}

/**
 * Serializable task record for persistence.
 * Only stores metadata - results are not cached.
 */
export interface TaskRecord {
  taskId: string;
  status: Task['status'];
  createdAt: string;
  lastUpdatedAt: string;
  statusMessage?: string;
  ttl?: number | null;
  pollInterval?: number;
}

/**
 * Internal storage structure.
 */
interface StoredTask {
  task: Task;
  request: Request;
  requestId: RequestId;
  result?: Result;
}

const TASKS_FILE = 'tasks.json';

/**
 * Creates a persistent task store.
 *
 * @param config - Configuration options
 * @returns A TaskStore instance with optional persistence
 */
export function createPersistentTaskStore(config?: PersistentTaskStoreConfig): TaskStore {
  const dataDir = config?.dataDir;
  const persistenceEnabled = config?.persistenceEnabled ?? true;
  const log = config?.onLog ?? (() => {});

  // In-memory storage (like SDK's InMemoryTaskStore)
  const tasks = new Map<string, StoredTask>();
  const cleanupTimers = new Map<string, NodeJS.Timeout>();

  // Initialize data directory and load existing tasks
  if (persistenceEnabled && dataDir) {
    ensureDataDir(dataDir);
    const loaded = loadTasksFromDisk(dataDir);
    log(`[TaskStore] Loaded ${loaded.length} tasks from disk`);
    // Note: We only load metadata for history - actual task state comes from server
    // The loaded records are available via getTaskHistory()
  }

  function generateTaskId(): string {
    return randomBytes(16).toString('hex');
  }

  function saveToDisk(): void {
    if (!persistenceEnabled || !dataDir) return;

    const records: TaskRecord[] = Array.from(tasks.values()).map(({ task }) => ({
      taskId: task.taskId,
      status: task.status,
      createdAt: task.createdAt,
      lastUpdatedAt: task.lastUpdatedAt,
      statusMessage: task.statusMessage,
      ttl: task.ttl,
      pollInterval: task.pollInterval,
    }));

    try {
      writeFileSync(join(dataDir, TASKS_FILE), JSON.stringify(records, null, 2));
    } catch (err) {
      log(`[TaskStore] Failed to save tasks: ${err}`);
    }
  }

  function scheduleCleanup(taskId: string, ttl: number): void {
    const existingTimer = cleanupTimers.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      tasks.delete(taskId);
      cleanupTimers.delete(taskId);
      saveToDisk();
    }, ttl);

    cleanupTimers.set(taskId, timer);
  }

  const store: TaskStore = {
    async createTask(
      taskParams: CreateTaskOptions,
      requestId: RequestId,
      request: Request,
      _sessionId?: string
    ): Promise<Task> {
      const taskId = generateTaskId();

      if (tasks.has(taskId)) {
        throw new Error(`Task with ID ${taskId} already exists`);
      }

      const actualTtl = taskParams.ttl ?? null;
      const createdAt = new Date().toISOString();

      const task: Task = {
        taskId,
        status: 'working',
        ttl: actualTtl,
        createdAt,
        lastUpdatedAt: createdAt,
        pollInterval: taskParams.pollInterval ?? 1000,
      };

      tasks.set(taskId, { task, request, requestId });
      saveToDisk();

      if (actualTtl) {
        scheduleCleanup(taskId, actualTtl);
      }

      return task;
    },

    async getTask(taskId: string, _sessionId?: string): Promise<Task | null> {
      const stored = tasks.get(taskId);
      return stored ? { ...stored.task } : null;
    },

    async storeTaskResult(
      taskId: string,
      status: 'completed' | 'failed',
      result: Result,
      _sessionId?: string
    ): Promise<void> {
      const stored = tasks.get(taskId);
      if (!stored) {
        throw new Error(`Task with ID ${taskId} not found`);
      }

      if (isTerminal(stored.task.status)) {
        throw new Error(
          `Cannot store result for task ${taskId} in terminal status '${stored.task.status}'. ` +
            `Task results can only be stored once.`
        );
      }

      stored.result = result;
      stored.task.status = status;
      stored.task.lastUpdatedAt = new Date().toISOString();
      saveToDisk();

      if (stored.task.ttl) {
        scheduleCleanup(taskId, stored.task.ttl);
      }
    },

    async getTaskResult(taskId: string, _sessionId?: string): Promise<Result> {
      const stored = tasks.get(taskId);
      if (!stored) {
        throw new Error(`Task with ID ${taskId} not found`);
      }
      if (!stored.result) {
        throw new Error(`Task ${taskId} has no result stored`);
      }
      return stored.result;
    },

    async updateTaskStatus(
      taskId: string,
      status: Task['status'],
      statusMessage?: string,
      _sessionId?: string
    ): Promise<void> {
      const stored = tasks.get(taskId);
      if (!stored) {
        throw new Error(`Task with ID ${taskId} not found`);
      }

      if (isTerminal(stored.task.status)) {
        throw new Error(
          `Cannot update task ${taskId} from terminal status '${stored.task.status}' to '${status}'. ` +
            `Terminal states (completed, failed, cancelled) cannot transition to other states.`
        );
      }

      stored.task.status = status;
      if (statusMessage) {
        stored.task.statusMessage = statusMessage;
      }
      stored.task.lastUpdatedAt = new Date().toISOString();
      saveToDisk();

      if (isTerminal(status) && stored.task.ttl) {
        scheduleCleanup(taskId, stored.task.ttl);
      }
    },

    async listTasks(
      cursor?: string,
      _sessionId?: string
    ): Promise<{ tasks: Task[]; nextCursor?: string }> {
      const PAGE_SIZE = 10;
      const allTaskIds = Array.from(tasks.keys());

      let startIndex = 0;
      if (cursor) {
        const cursorIndex = allTaskIds.indexOf(cursor);
        if (cursorIndex >= 0) {
          startIndex = cursorIndex + 1;
        } else {
          throw new Error(`Invalid cursor: ${cursor}`);
        }
      }

      const pageTaskIds = allTaskIds.slice(startIndex, startIndex + PAGE_SIZE);
      const taskList = pageTaskIds.map((taskId) => {
        const stored = tasks.get(taskId)!;
        return { ...stored.task };
      });

      const nextCursor =
        startIndex + PAGE_SIZE < allTaskIds.length
          ? pageTaskIds[pageTaskIds.length - 1]
          : undefined;

      return { tasks: taskList, nextCursor };
    },
  };

  return store;
}

/**
 * Ensures the data directory exists.
 */
function ensureDataDir(dataDir: string): void {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Loads task records from disk.
 *
 * @param dataDir - Directory containing tasks.json
 * @returns Array of task records (metadata only)
 */
export function loadTasksFromDisk(dataDir: string): TaskRecord[] {
  const filePath = join(dataDir, TASKS_FILE);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const records = JSON.parse(content) as TaskRecord[];
    return records;
  } catch {
    return [];
  }
}

/**
 * Gets task history from the data directory.
 * Useful for viewing past tasks after restart.
 *
 * @param dataDir - Directory containing tasks.json
 * @returns Array of task records
 */
export function getTaskHistory(dataDir: string): TaskRecord[] {
  return loadTasksFromDisk(dataDir);
}

/**
 * Clears all persisted tasks.
 *
 * @param dataDir - Directory containing tasks.json
 */
export function clearTaskHistory(dataDir: string): void {
  const filePath = join(dataDir, TASKS_FILE);
  if (existsSync(filePath)) {
    writeFileSync(filePath, '[]');
  }
}
