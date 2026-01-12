/**
 * Tool Execution Hook
 *
 * Executes tool calls from LLM responses.
 * Routes theme tools to client-side execution via useThemeTools.
 * Routes MCP tools to server API.
 */

import { useCallback } from 'react';
import { useChat } from '../context/ChatContext';
import { useThemeTools, isThemeTool } from './useThemeTools';
import type { ChatToolCall } from '../types';

export interface ToolExecutionResult {
  success: boolean;
  content: unknown;
  isError?: boolean;
}

export function useToolExecution() {
  const { updateToolCall } = useChat();
  const { executeThemeTool } = useThemeTools();

  /**
   * Execute a single tool call
   */
  const executeTool = useCallback(
    async (messageId: string, toolCall: ChatToolCall): Promise<ToolExecutionResult> => {
      // Mark as executing
      updateToolCall(messageId, toolCall.id, { status: 'executing' });

      try {
        let result: ToolExecutionResult;

        if (isThemeTool(toolCall.name)) {
          // Execute theme tools client-side
          const themeResult = await executeThemeTool(toolCall);
          result = {
            success: themeResult.success,
            content: themeResult.message,
            isError: !themeResult.success,
          };
        } else {
          // Execute MCP tools via server API
          const response = await fetch(`/api/tools/${encodeURIComponent(toolCall.name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ arguments: toolCall.arguments }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();
          result = {
            success: true,
            content: data.result ?? data,
            isError: data.isError ?? false,
          };
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
    [updateToolCall, executeThemeTool]
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
