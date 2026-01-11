import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPersistentTaskStore,
  loadTasksFromDisk,
  getTaskHistory,
  clearTaskHistory,
} from './persistent-task-store.js';

describe('PersistentTaskStore', () => {
  const testDataDir = join(tmpdir(), 'skilljack-test-' + Date.now());

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true });
    }
  });

  describe('createPersistentTaskStore', () => {
    it('should create a task store', () => {
      const store = createPersistentTaskStore({
        dataDir: testDataDir,
        persistenceEnabled: true,
      });

      expect(store).toBeDefined();
      expect(store.createTask).toBeTypeOf('function');
      expect(store.getTask).toBeTypeOf('function');
      expect(store.listTasks).toBeTypeOf('function');
    });

    it('should create task and persist to disk', async () => {
      const store = createPersistentTaskStore({
        dataDir: testDataDir,
        persistenceEnabled: true,
      });

      const task = await store.createTask(
        { ttl: 60000 },
        'req-1',
        { method: 'test', params: {} }
      );

      expect(task.taskId).toBeDefined();
      expect(task.status).toBe('working');
      expect(task.createdAt).toBeDefined();

      // Check file was created
      const filePath = join(testDataDir, 'tasks.json');
      expect(existsSync(filePath)).toBe(true);

      // Check file contents
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content).toHaveLength(1);
      expect(content[0].taskId).toBe(task.taskId);
    });

    it('should update task status and persist', async () => {
      const store = createPersistentTaskStore({
        dataDir: testDataDir,
        persistenceEnabled: true,
      });

      const task = await store.createTask(
        {},
        'req-1',
        { method: 'test', params: {} }
      );

      await store.updateTaskStatus(task.taskId, 'completed', 'Done!');

      const updated = await store.getTask(task.taskId);
      expect(updated?.status).toBe('completed');
      expect(updated?.statusMessage).toBe('Done!');

      // Check persisted
      const content = JSON.parse(readFileSync(join(testDataDir, 'tasks.json'), 'utf-8'));
      expect(content[0].status).toBe('completed');
    });

    it('should work without persistence', async () => {
      const store = createPersistentTaskStore({
        dataDir: testDataDir,
        persistenceEnabled: false,
      });

      const task = await store.createTask(
        {},
        'req-1',
        { method: 'test', params: {} }
      );

      expect(task.taskId).toBeDefined();

      // File should NOT exist
      const filePath = join(testDataDir, 'tasks.json');
      expect(existsSync(filePath)).toBe(false);
    });

    it('should list tasks with pagination', async () => {
      const store = createPersistentTaskStore({
        dataDir: testDataDir,
        persistenceEnabled: true,
      });

      // Create 3 tasks
      const task1 = await store.createTask({}, 'req-1', { method: 'test', params: {} });
      const task2 = await store.createTask({}, 'req-2', { method: 'test', params: {} });
      const task3 = await store.createTask({}, 'req-3', { method: 'test', params: {} });

      const result = await store.listTasks();
      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].taskId).toBe(task1.taskId);
      expect(result.tasks[2].taskId).toBe(task3.taskId);
    });
  });

  describe('utility functions', () => {
    it('getTaskHistory should return persisted tasks', async () => {
      const store = createPersistentTaskStore({
        dataDir: testDataDir,
        persistenceEnabled: true,
      });

      await store.createTask({}, 'req-1', { method: 'test', params: {} });
      await store.createTask({}, 'req-2', { method: 'test', params: {} });

      const history = getTaskHistory(testDataDir);
      expect(history).toHaveLength(2);
    });

    it('clearTaskHistory should empty the file', async () => {
      const store = createPersistentTaskStore({
        dataDir: testDataDir,
        persistenceEnabled: true,
      });

      await store.createTask({}, 'req-1', { method: 'test', params: {} });

      clearTaskHistory(testDataDir);

      const history = loadTasksFromDisk(testDataDir);
      expect(history).toHaveLength(0);
    });
  });
});
