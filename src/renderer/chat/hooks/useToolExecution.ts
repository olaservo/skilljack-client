/**
 * Tool Execution Hook
 *
 * Executes tool calls from LLM responses.
 * Routes theme tools to client-side execution via useThemeTools.
 * Routes MCP tools via communication adapter (IPC in Electron, HTTP in web).
 * Loads MCP Apps for tools with UI resources.
 */

import { useCallback } from 'react';
import { useChat } from '../context/ChatContext';
import { useThemeTools, isThemeTool } from './useThemeTools';
import { getCommunicationAdapter } from '../../hooks/useCommunication';
import type { ChatToolCall } from '../types';

// Declare global loadMcpApp function from app.js
declare global {
  interface Window {
    loadMcpApp?: (
      serverName: string,
      uiResourceUri: string,
      toolInput: Record<string, unknown>,
      toolResult: unknown
    ) => Promise<void>;
  }
}

export interface ToolExecutionResult {
  success: boolean;
  content: unknown;
  isError?: boolean;
}

export function useToolExecution() {
  const { updateToolCall, state } = useChat();
  const { executeThemeTool } = useThemeTools();
  const adapter = getCommunicationAdapter();

  // Find tool info by name to get UI resource info
  const getToolInfo = useCallback(
    (toolName: string) => {
      return state.tools.find((t) => t.name === toolName);
    },
    [state.tools]
  );

  /**
   * Execute a single tool call
   */
  const executeTool = useCallback(
    async (messageId: string, toolCall: ChatToolCall): Promise<ToolExecutionResult> => {
      // Mark as executing
      updateToolCall(messageId, toolCall.id, { status: 'executing' });

      try {
        let result: ToolExecutionResult;

        if (isThemeTool(toolCall.qualifiedName)) {
          // Execute theme tools client-side
          const themeResult = await executeThemeTool(toolCall);
          result = {
            success: themeResult.success,
            content: themeResult.message,
            isError: !themeResult.success,
          };
        } else {
          // Execute MCP tools via communication adapter (IPC in Electron, HTTP in web)
          const data = await adapter.callTool(toolCall.qualifiedName, toolCall.arguments);
          result = {
            success: true,
            content: data.content ?? data,
            isError: data.isError ?? false,
          };

          // Load MCP App if tool has UI resource
          const toolInfo = getToolInfo(toolCall.qualifiedName);
          if (toolInfo?.hasUi && toolInfo.uiResourceUri && window.loadMcpApp) {
            try {
              await window.loadMcpApp(
                toolInfo.serverName,
                toolInfo.uiResourceUri,
                toolCall.arguments,
                result.content
              );
            } catch (err) {
              console.error('[Chat] Failed to load MCP App:', err);
            }
          }
        }

        // Update tool call with result
        updateToolCall(messageId, toolCall.id, {
          status: result.isError ? 'failed' : 'completed',
          result: {
            content: result.content,
            isError: result.isError,
          },
        });

        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';

        updateToolCall(messageId, toolCall.id, {
          status: 'failed',
          result: {
            content: errorMessage,
            isError: true,
          },
        });

        return {
          success: false,
          content: errorMessage,
          isError: true,
        };
      }
    },
    [updateToolCall, executeThemeTool, getToolInfo]
  );

  /**
   * Execute all pending tool calls in a message
   */
  const executeAllTools = useCallback(
    async (messageId: string, toolCalls: ChatToolCall[]): Promise<ToolExecutionResult[]> => {
      const results: ToolExecutionResult[] = [];

      for (const toolCall of toolCalls) {
        if (toolCall.status === 'pending') {
          const result = await executeTool(messageId, toolCall);
          results.push(result);
        }
      }

      return results;
    },
    [executeTool]
  );

  return {
    executeTool,
    executeAllTools,
  };
}
