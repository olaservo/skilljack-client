/**
 * Chat Types Tests
 *
 * Tests to ensure ChatToolCall uses correct property names.
 * This prevents the regression where toolCall.name was used instead of toolCall.qualifiedName.
 */

import { describe, it, expect } from 'vitest';
import type { ChatToolCall, McpTool } from '../src/renderer/chat/types';

describe('ChatToolCall Type', () => {
  it('should have qualifiedName property (not name)', () => {
    const toolCall: ChatToolCall = {
      id: 'test-id',
      qualifiedName: 'server__tool',
      displayName: 'tool',
      serverName: 'server',
      arguments: {},
      status: 'pending',
    };

    // Verify qualifiedName exists and is correct
    expect(toolCall.qualifiedName).toBe('server__tool');

    // TypeScript would catch this at compile time, but this documents the intent
    expect('qualifiedName' in toolCall).toBe(true);
    expect('name' in toolCall).toBe(false);
  });

  it('should use qualifiedName for API calls', () => {
    const toolCall: ChatToolCall = {
      id: 'test-id',
      qualifiedName: 'everything__echo',
      displayName: 'echo',
      serverName: 'everything',
      arguments: { message: 'hello' },
      status: 'pending',
    };

    // The qualifiedName should be used for API calls
    const apiPayload = {
      name: toolCall.qualifiedName,
      args: toolCall.arguments,
    };

    expect(apiPayload.name).toBe('everything__echo');
    expect(apiPayload.args).toEqual({ message: 'hello' });
  });

  it('should use displayName for UI display', () => {
    const toolCall: ChatToolCall = {
      id: 'test-id',
      qualifiedName: 'filesystem__read_file',
      displayName: 'read_file',
      serverName: 'filesystem',
      arguments: { path: '/test' },
      status: 'completed',
      result: { content: 'file contents', isError: false },
    };

    // UI should show displayName, not qualifiedName
    const uiLabel = toolCall.displayName;
    expect(uiLabel).toBe('read_file');
    expect(uiLabel).not.toBe('filesystem__read_file');
  });
});

describe('McpTool Type', () => {
  it('should have name as qualified name and originalName as display name', () => {
    const tool: McpTool = {
      name: 'server__tool',
      originalName: 'tool',
      serverName: 'server',
      description: 'A test tool',
    };

    expect(tool.name).toBe('server__tool');
    expect(tool.originalName).toBe('tool');
  });

  it('should track UI resource info', () => {
    const toolWithUI: McpTool = {
      name: 'server__interactive_tool',
      originalName: 'interactive_tool',
      serverName: 'server',
      hasUi: true,
      uiResourceUri: 'resource://ui/tool-panel',
    };

    expect(toolWithUI.hasUi).toBe(true);
    expect(toolWithUI.uiResourceUri).toBe('resource://ui/tool-panel');
  });
});

describe('Tool Name Matching', () => {
  it('should match tools by qualifiedName', () => {
    const tools: McpTool[] = [
      { name: 'server1__tool_a', originalName: 'tool_a', serverName: 'server1' },
      { name: 'server2__tool_b', originalName: 'tool_b', serverName: 'server2' },
      { name: 'server1__tool_b', originalName: 'tool_b', serverName: 'server1' },
    ];

    const toolCall: ChatToolCall = {
      id: 'test',
      qualifiedName: 'server2__tool_b',
      displayName: 'tool_b',
      serverName: 'server2',
      arguments: {},
      status: 'pending',
    };

    // Finding tool by qualifiedName should match exactly
    const matchedTool = tools.find(t => t.name === toolCall.qualifiedName);
    expect(matchedTool).toBeDefined();
    expect(matchedTool?.serverName).toBe('server2');
  });

  it('should not confuse tools with same displayName from different servers', () => {
    const tools: McpTool[] = [
      { name: 'server1__read', originalName: 'read', serverName: 'server1' },
      { name: 'server2__read', originalName: 'read', serverName: 'server2' },
    ];

    // Using displayName alone would be ambiguous
    const displayNameMatches = tools.filter(t => t.originalName === 'read');
    expect(displayNameMatches).toHaveLength(2);

    // Using qualifiedName is unambiguous
    const qualifiedNameMatch = tools.find(t => t.name === 'server1__read');
    expect(qualifiedNameMatch).toBeDefined();
    expect(qualifiedNameMatch?.serverName).toBe('server1');
  });
});
