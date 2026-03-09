/**
 * useCodingAgent Hook
 *
 * Bridges the coding agent adapter (IPC) to ChatContext dispatch.
 * Translates agent events into reducer actions.
 *
 * Responsibilities:
 * 1. Subscribe to IPC agent events and dispatch them to the reducer
 * 2. Auto-trigger startRun when state.agentRun appears
 * 3. Expose steer/abort controls for the UI
 */

import { useCallback, useEffect, useRef } from 'react';
import { useChat } from '../context/ChatContext';
import type { ChatAction } from '../types';
import type { Dispatch } from 'react';

/** Agent event shape received from IPC (mirrors AgentEvent from adapter.ts) */
interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

/** Track aborted message IDs so post-abort events are ignored */
const abortedMessageIds = new Set<string>();

export function useCodingAgent() {
  const { dispatch, state } = useChat();
  const abortRef = useRef<(() => void) | null>(null);
  const steerRef = useRef<((msg: string) => void) | null>(null);
  const startedRef = useRef(false);

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

      // Subscribe to events BEFORE calling execute() to avoid race condition
      // where early events could be missed if the listener isn't set up yet.
      const unsub = api.codingAgent.onEvent((event) => {
        handleAgentEvent(dispatch, messageId, event as AgentEvent);
      });

      try {
        // Start the pi subprocess — cwd defaults to main process cwd
        await api.codingAgent.start({});

        // Execute the task — events stream via IPC onEvent listener
        await api.codingAgent.execute(task);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        dispatch({ type: 'AGENT_RUN_ERROR', messageId, error: msg });
      } finally {
        unsub();
        abortRef.current = null;
        steerRef.current = null;
      }
    },
    [dispatch]
  );

  // Auto-trigger startRun when a new agent run appears in state
  useEffect(() => {
    if (state.agentRun && !startedRef.current) {
      startedRef.current = true;
      startRun(state.agentRun.task, state.agentRun.messageId);
    }
    if (!state.agentRun) {
      startedRef.current = false;
      // Clean up stale aborted IDs when no run is active — prevents
      // unbounded growth if a process crashes before sending a terminal event.
      abortedMessageIds.clear();
    }
  }, [state.agentRun, startRun]);

  const steer = useCallback(async (message: string) => {
    await steerRef.current?.(message);
  }, []);

  const abort = useCallback(async () => {
    if (abortRef.current && state.agentRun) {
      abortedMessageIds.add(state.agentRun.messageId);
      dispatch({ type: 'AGENT_RUN_ABORT', messageId: state.agentRun.messageId });
      await abortRef.current();
    }
  }, [state.agentRun, dispatch]);

  return { steer, abort };
}

/**
 * Handles a single agent event by dispatching the appropriate reducer action.
 * Called from the IPC event listener setup in startRun.
 */
export function handleAgentEvent(
  dispatch: Dispatch<ChatAction>,
  messageId: string,
  event: AgentEvent
): void {
  // Ignore events for messages that were already aborted
  if (abortedMessageIds.has(messageId)) {
    if (event.type === 'complete' || event.type === 'error') {
      // Terminal event — clean up tracking
      abortedMessageIds.delete(messageId);
    }
    return;
  }

  switch (event.type) {
    case 'text_delta': {
      const textDelta = typeof event.delta === 'string' ? event.delta : '';
      if (textDelta) {
        dispatch({
          type: 'AGENT_BLOCK_TEXT_DELTA',
          messageId,
          delta: textDelta,
        });
      }
      break;
    }

    case 'thinking_delta': {
      const thinkingDelta = typeof event.delta === 'string' ? event.delta : '';
      if (thinkingDelta) {
        dispatch({
          type: 'AGENT_BLOCK_THINKING_DELTA',
          messageId,
          delta: thinkingDelta,
        });
      }
      break;
    }

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

    case 'tool_update':
      // Partial tool results (e.g. streaming bash output) — log for now
      // TODO: Add AGENT_BLOCK_TOOL_UPDATE reducer action for live streaming
      console.log('[CodingAgent] tool_update:', event.toolCallId);
      break;

    case 'set_widget':
      // Widget updates from extensions — log for now
      // TODO: Add AGENT_SET_WIDGET reducer action for widget display
      console.log('[CodingAgent] set_widget:', event.widgetKey);
      break;

    case 'ui_request': {
      // Auto-cancel unhandled UI requests so pi doesn't block indefinitely.
      // TODO: Implement proper UI for select, confirm, input, editor requests.
      const api = window.electronAPI;
      if (api?.codingAgent && event.id) {
        api.codingAgent.respondToUIRequest({
          type: 'extension_ui_response',
          id: event.id as string,
          cancelled: true,
        });
      }
      console.warn('[CodingAgent] Auto-cancelled unhandled UI request:', event.method);
      break;
    }
  }
}
