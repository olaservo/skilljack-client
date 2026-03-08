/**
 * useCodingAgent Hook
 *
 * Bridges the coding agent adapter (IPC) to ChatContext dispatch.
 * Translates agent events into reducer actions.
 */

import { useCallback, useRef } from 'react';
import { useChat } from '../context/ChatContext';
import type { ChatAction } from '../types';
import type { Dispatch } from 'react';

/** Agent event shape received from IPC (mirrors AgentEvent from adapter.ts) */
interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export function useCodingAgent() {
  const { dispatch, state } = useChat();
  const abortRef = useRef<(() => void) | null>(null);
  const steerRef = useRef<((msg: string) => void) | null>(null);

  const startRun = useCallback(
    async (task: string, messageId: string) => {
      const api = window.electronAPI;
      if (!api?.codingAgent) {
        dispatch({
          type: 'AGENT_RUN_ERROR',
          messageId,
          error: 'Coding agent not available (requires Electron)',
        });
        return;
      }

      // Store controls
      abortRef.current = () => api.codingAgent.abort();
      steerRef.current = (msg) => api.codingAgent.steer(msg);

      try {
        // Start the pi subprocess
        await api.codingAgent.start({
          cwd: process.cwd?.() ?? '.',
        });

        // Execute the task — events stream via IPC
        await api.codingAgent.execute(task);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        dispatch({ type: 'AGENT_RUN_ERROR', messageId, error: msg });
      } finally {
        abortRef.current = null;
        steerRef.current = null;
      }
    },
    [dispatch]
  );

  const steer = useCallback(async (message: string) => {
    await steerRef.current?.(message);
  }, []);

  const abort = useCallback(async () => {
    await abortRef.current?.();
  }, []);

  return { startRun, steer, abort };
}

/**
 * Handles a single agent event by dispatching the appropriate reducer action.
 * Called from the IPC event listener setup in the preload/main bridge.
 */
export function handleAgentEvent(
  dispatch: Dispatch<ChatAction>,
  messageId: string,
  event: AgentEvent
): void {
  switch (event.type) {
    case 'text_delta':
      dispatch({
        type: 'AGENT_BLOCK_TEXT_DELTA',
        messageId,
        delta: event.delta as string,
      });
      break;

    case 'thinking_delta':
      dispatch({
        type: 'AGENT_BLOCK_THINKING_DELTA',
        messageId,
        delta: event.delta as string,
      });
      break;

    case 'tool_start':
      dispatch({
        type: 'AGENT_BLOCK_TOOL_START',
        messageId,
        toolCallId: event.toolCallId as string,
        toolName: event.toolName as string,
        args: (event.args as Record<string, unknown>) ?? {},
      });
      break;

    case 'tool_end':
      dispatch({
        type: 'AGENT_BLOCK_TOOL_END',
        messageId,
        toolCallId: event.toolCallId as string,
        result: event.result,
        isError: (event.isError as boolean) ?? false,
      });
      break;

    case 'status':
      dispatch({
        type: 'AGENT_BLOCK_STATUS',
        messageId,
        message: event.message as string,
      });
      break;

    case 'set_status':
      dispatch({
        type: 'AGENT_SET_STATUS',
        messageId,
        statusKey: event.statusKey as string,
        statusText: event.statusText as string | undefined,
      });
      break;

    case 'set_title':
      dispatch({
        type: 'AGENT_SET_TITLE',
        messageId,
        title: event.title as string,
      });
      break;

    case 'complete':
      dispatch({
        type: 'AGENT_RUN_COMPLETE',
        messageId,
        usage: event.usage as { inputTokens: number; outputTokens: number; totalCost: number } | undefined,
      });
      break;

    case 'error':
      dispatch({
        type: 'AGENT_RUN_ERROR',
        messageId,
        error: event.message as string,
      });
      break;

    case 'ui_request':
      // TODO: Handle extension UI requests (select, confirm, input, editor)
      // For now, log them
      console.log('[CodingAgent] UI request:', event);
      break;
  }
}
