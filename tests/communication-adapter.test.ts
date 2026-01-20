/**
 * Communication Adapter Tests
 *
 * Tests for the communication adapter singleton behavior.
 * Critical: Multiple calls to getCommunicationAdapter() must return the same instance.
 * This prevents the IPC adapter's globalActiveStreams from being overwritten.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock window.electronAPI for Electron environment simulation
const mockElectronAPI = {
  getServers: vi.fn(),
  getTools: vi.fn(),
  callTool: vi.fn(),
  getConfig: vi.fn(),
  getToolManagerTools: vi.fn(),
  setToolEnabled: vi.fn(),
  getToolManagerServers: vi.fn(),
  setServerEnabled: vi.fn(),
  getResources: vi.fn(),
  readResource: vi.fn(),
  getUIResource: vi.fn(),
  getPrompts: vi.fn(),
  startChatStream: vi.fn(),
  onChatStreamEvent: vi.fn(() => () => {}),
  onToolsChanged: vi.fn(() => () => {}),
  onServersChanged: vi.fn(() => () => {}),
  onResourceUpdated: vi.fn(() => () => {}),
  onConnectionError: vi.fn(() => () => {}),
};

describe('Communication Adapter Singleton', () => {
  beforeEach(() => {
    // Reset module state between tests
    vi.resetModules();

    // Set up window.electronAPI mock
    (globalThis as any).window = {
      electronAPI: mockElectronAPI,
    };
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('getCommunicationAdapter returns the same instance on multiple calls', async () => {
    const { getCommunicationAdapter } = await import('../src/renderer/hooks/useCommunication');

    const adapter1 = getCommunicationAdapter();
    const adapter2 = getCommunicationAdapter();
    const adapter3 = getCommunicationAdapter();

    expect(adapter1).toBe(adapter2);
    expect(adapter2).toBe(adapter3);
  });

  it('useCommunication returns the same instance as getCommunicationAdapter', async () => {
    const { getCommunicationAdapter, useCommunication } = await import('../src/renderer/hooks/useCommunication');

    const staticAdapter = getCommunicationAdapter();
    const hookAdapter = useCommunication();

    expect(hookAdapter).toBe(staticAdapter);
  });

  it('adapter is created only once even with multiple imports', async () => {
    // First import
    const module1 = await import('../src/renderer/hooks/useCommunication');
    const adapter1 = module1.getCommunicationAdapter();

    // Second import (should return cached module)
    const module2 = await import('../src/renderer/hooks/useCommunication');
    const adapter2 = module2.getCommunicationAdapter();

    expect(adapter1).toBe(adapter2);
  });
});

describe('IPC Adapter', () => {
  beforeEach(() => {
    vi.resetModules();

    (globalThis as any).window = {
      electronAPI: mockElectronAPI,
    };
  });

  afterEach(() => {
    delete (globalThis as any).window;
    vi.clearAllMocks();
  });

  it('callTool passes name and args to electronAPI', async () => {
    const { getCommunicationAdapter } = await import('../src/renderer/hooks/useCommunication');

    mockElectronAPI.callTool.mockResolvedValue({ content: 'result', isError: false });

    const adapter = getCommunicationAdapter();
    const result = await adapter.callTool('test-tool', { arg1: 'value1' });

    expect(mockElectronAPI.callTool).toHaveBeenCalledWith('test-tool', { arg1: 'value1' });
    expect(result).toEqual({ content: 'result', isError: false });
  });

  it('getServers returns server list from electronAPI', async () => {
    const { getCommunicationAdapter } = await import('../src/renderer/hooks/useCommunication');

    mockElectronAPI.getServers.mockResolvedValue({
      servers: [{ name: 'test-server', version: '1.0.0', toolCount: 5 }]
    });

    const adapter = getCommunicationAdapter();
    const servers = await adapter.getServers();

    expect(servers).toEqual([{ name: 'test-server', version: '1.0.0', toolCount: 5 }]);
  });

  it('getTools returns tool list from electronAPI', async () => {
    const { getCommunicationAdapter } = await import('../src/renderer/hooks/useCommunication');

    mockElectronAPI.getTools.mockResolvedValue({
      tools: [{ name: 'server__tool', displayName: 'tool', serverName: 'server' }]
    });

    const adapter = getCommunicationAdapter();
    const tools = await adapter.getTools();

    expect(tools).toEqual([{ name: 'server__tool', displayName: 'tool', serverName: 'server' }]);
  });
});

describe('HTTP Adapter Fallback', () => {
  beforeEach(() => {
    vi.resetModules();

    // No electronAPI = web mode
    (globalThis as any).window = {};
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('creates HTTP adapter when electronAPI is not available', async () => {
    const { getCommunicationAdapter, isElectron } = await import('../src/renderer/hooks/useCommunication');

    expect(isElectron()).toBe(false);

    const adapter = getCommunicationAdapter();
    expect(adapter).toBeDefined();
    // HTTP adapter will have callTool method
    expect(typeof adapter.callTool).toBe('function');
  });
});
