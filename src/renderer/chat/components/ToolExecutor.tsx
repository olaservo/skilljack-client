/**
 * Tool Executor Component
 *
 * Watches for pending tool calls and executes them.
 * After tools complete, ChatContext's useEffect handles continuation for multi-turn workflows.
 * This is a "behavior" component - it doesn't render anything visible.
 */

import { useEffect, useRef } from 'react';
import { useChat } from '../context/ChatContext';
import { useToolExecution } from '../hooks';

export function ToolExecutor() {
  const { state } = useChat();
  const { executeAllTools } = useToolExecution();
  const executingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Find messages that have finished streaming and have pending tool calls
    for (const message of state.messages) {
      // Skip if still streaming
      if (message.isStreaming) continue;

      // Skip if no tool calls
      if (!message.toolCalls || message.toolCalls.length === 0) continue;

      // Check if any tool calls are pending
      const pendingTools = message.toolCalls.filter((tc) => tc.status === 'pending');
      if (pendingTools.length === 0) continue;

      // Skip if already executing this message's tools
      if (executingRef.current.has(message.id)) continue;

      // Mark as executing and run
      executingRef.current.add(message.id);
      console.log('[ToolExecutor] Executing tools for message:', message.id, pendingTools.map(t => t.displayName));

      executeAllTools(message.id, pendingTools)
        .then((results) => {
          console.log('[ToolExecutor] Tools executed:', results);
          executingRef.current.delete(message.id);
          // Note: Continuation is handled by ChatContext's useEffect that watches for completed tools
        })
        .catch((err) => {
          console.error('[ToolExecutor] Error executing tools:', err);
          executingRef.current.delete(message.id);
        });
    }
  }, [state.messages, executeAllTools]);

  // This component doesn't render anything
  return null;
}
