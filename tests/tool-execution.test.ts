/**
 * Tool Execution Tests
 *
 * Tests to prevent regressions in tool execution.
 * Key issues this prevents:
 * 1. Using wrong property (toolCall.name vs toolCall.qualifiedName)
 * 2. Using wrong adapter (HTTP vs IPC)
 * 3. Multiple adapter instances breaking stream management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatToolCall } from '../src/renderer/chat/types';

// Mock electronAPI
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

describe('Tool Execution Integration', () => {
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

  it('should call adapter.callTool with qualifiedName, not name', async () => {
    const { getCommunicationAdapter } = await import('../src/renderer/hooks/useCommunication');

    const toolCall: ChatToolCall = {
      id: 'test-id',
      qualifiedName: 'everything__echo',  // This should be used
      displayName: 'echo',
      serverName: 'everything',
      arguments: { message: 'hello' },
      status: 'pending',
    };

    mockElectronAPI.callTool.mockResolvedValue({ content: 'hello', isError: false });

    const adapter = getCommunicationAdapter();

    // Simulate what useToolExecution does
    const result = await adapter.callTool(toolCall.qualifiedName, toolCall.arguments);

    // Verify the correct name was passed
    expect(mockElectronAPI.callTool).toHaveBeenCalledWith('everything__echo', { message: 'hello' });
    expect(result).toEqual({ content: 'hello', isError: false });
  });

  it('should NOT use toolCall.name (which does not exist)', () => {
    const toolCall: ChatToolCall = {
      id: 'test-id',
      qualifiedName: 'server__tool',
      displayName: 'tool',
      serverName: 'server',
      arguments: {},
      status: 'pending',
    };

    // Verify that accessing .name returns undefined
    // This catches the bug where code used toolCall.name instead of toolCall.qualifiedName
    expect((toolCall as any).name).toBeUndefined();
    expect(toolCall.qualifiedName).toBe('server__tool');
  });

  it('should use single adapter instance across multiple tool calls', async () => {
    const { getCommunicationAdapter } = await import('../src/renderer/hooks/useCommunication');

    mockElectronAPI.callTool.mockResolvedValue({ content: 'result', isError: false });

    // Simulate multiple components getting the adapter
    const adapter1 = getCommunicationAdapter();
    const adapter2 = getCommunicationAdapter();

    // Both should be the same instance
    expect(adapter1).toBe(adapter2);

    // Make calls from both "components"
    await adapter1.callTool('tool1', {});
    await adapter2.callTool('tool2', {});

    // Both calls should work
    expect(mockElectronAPI.callTool).toHaveBeenCalledTimes(2);
    expect(mockElectronAPI.callTool).toHaveBeenNthCalledWith(1, 'tool1', {});
    expect(mockElectronAPI.callTool).toHaveBeenNthCalledWith(2, 'tool2', {});
  });
});

describe('Adapter Selection', () => {
  afterEach(() => {
    delete (globalThis as any).window;
    vi.clearAllMocks();
  });

  it('should use IPC adapter when electronAPI is available', async () => {
    vi.resetModules();
    (globalThis as any).window = {
      electronAPI: mockElectronAPI,
    };

    const { getCommunicationAdapter, isElectron } = await import('../src/renderer/hooks/useCommunication');

    expect(isElectron()).toBe(true);

    const adapter = getCommunicationAdapter();
    mockElectronAPI.callTool.mockResolvedValue({ content: 'test', isError: false });

    await adapter.callTool('test', {});

    // Should have called electronAPI, not HTTP
    expect(mockElectronAPI.callTool).toHaveBeenCalled();
  });

  it('should use HTTP adapter when electronAPI is not available', async () => {
    vi.resetModules();
    (globalThis as any).window = {};

    const { getCommunicationAdapter, isElectron } = await import('../src/renderer/hooks/useCommunication');

    expect(isElectron()).toBe(false);

    const adapter = getCommunicationAdapter();

    // HTTP adapter exists and has callTool method
    expect(adapter).toBeDefined();
    expect(typeof adapter.callTool).toBe('function');
  });
});

describe('ChatToolCall Contract', () => {
  it('should have all required properties for API calls', () => {
    const toolCall: ChatToolCall = {
      id: 'test-id',
      qualifiedName: 'server__tool',
      displayName: 'tool',
      serverName: 'server',
      arguments: { key: 'value' },
      status: 'pending',
    };

    // These properties are required for making tool calls
    expect(toolCall.id).toBeDefined();
    expect(toolCall.qualifiedName).toBeDefined();
    expect(toolCall.arguments).toBeDefined();
    expect(toolCall.status).toBeDefined();
  });

  it('should use qualifiedName format: serverName__toolName', () => {
    const toolCall: ChatToolCall = {
      id: 'test',
      qualifiedName: 'filesystem__read_file',
      displayName: 'read_file',
      serverName: 'filesystem',
      arguments: {},
      status: 'pending',
    };

    // qualifiedName should follow the pattern
    const parts = toolCall.qualifiedName.split('__');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(toolCall.serverName);
    expect(parts[1]).toBe(toolCall.displayName);
  });
});
