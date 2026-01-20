import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProcessManager } from '../src/core/process-manager.js';
import type { StdioServerConfig } from '../src/types/config.js';

describe('ProcessManager', () => {
  const testConfig: StdioServerConfig = {
    type: 'stdio',
    command: process.platform === 'win32' ? 'cmd' : 'sh',
    args: process.platform === 'win32' ? ['/c', 'echo hello'] : ['-c', 'echo hello'],
  };

  let manager: ProcessManager | null = null;

  afterEach(async () => {
    if (manager) {
      await manager.stop();
      manager = null;
    }
  });

  it('initializes with correct state', () => {
    manager = new ProcessManager('test', testConfig);
    expect(manager.isRunning()).toBe(false);
    expect(manager.getPid()).toBeUndefined();
    expect(manager.getProcess()).toBeNull();
  });

  it('starts a process successfully', async () => {
    manager = new ProcessManager('test', testConfig, 5000);

    const startedPromise = new Promise<number>((resolve) => {
      manager!.once('started', resolve);
    });

    await manager.start();
    const pid = await startedPromise;

    expect(pid).toBeGreaterThan(0);
    expect(manager.getPid()).toBe(pid);
  });

  it('emits exited event when process ends', async () => {
    manager = new ProcessManager('test', testConfig, 5000);

    const exitedPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      manager!.once('exited', (code, signal) => resolve({ code, signal }));
    });

    await manager.start();
    const result = await exitedPromise;

    expect(result.code).toBe(0);
  });

  it('throws when starting already running process', async () => {
    // Use a long-running command
    const longRunningConfig: StdioServerConfig = {
      type: 'stdio',
      command: process.platform === 'win32' ? 'cmd' : 'sh',
      args: process.platform === 'win32'
        ? ['/c', 'ping -n 10 127.0.0.1']
        : ['-c', 'sleep 10'],
    };

    manager = new ProcessManager('test', longRunningConfig, 5000);
    await manager.start();

    await expect(manager.start()).rejects.toThrow('Process already running');
  });

  it('stops a running process', async () => {
    const longRunningConfig: StdioServerConfig = {
      type: 'stdio',
      command: process.platform === 'win32' ? 'cmd' : 'sh',
      args: process.platform === 'win32'
        ? ['/c', 'ping -n 10 127.0.0.1']
        : ['-c', 'sleep 10'],
    };

    manager = new ProcessManager('test', longRunningConfig, 5000);
    await manager.start();

    expect(manager.isRunning()).toBe(true);

    await manager.stop();

    expect(manager.isRunning()).toBe(false);
    expect(manager.getProcess()).toBeNull();
  });

  it('handles stop when no process running', async () => {
    manager = new ProcessManager('test', testConfig);
    // Should not throw
    await manager.stop();
  });

  it('provides stdin/stdout streams', async () => {
    const longRunningConfig: StdioServerConfig = {
      type: 'stdio',
      command: process.platform === 'win32' ? 'cmd' : 'sh',
      args: process.platform === 'win32'
        ? ['/c', 'ping -n 10 127.0.0.1']
        : ['-c', 'sleep 10'],
    };

    manager = new ProcessManager('test', longRunningConfig, 5000);
    await manager.start();

    expect(manager.getStdin()).not.toBeNull();
    expect(manager.getStdout()).not.toBeNull();
  });
});
