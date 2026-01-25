/**
 * Tool Executor Component
 *
 * Watches for pending tool calls and executes them.
 * Respects confirmDangerousTools setting - skips dangerous tools if enabled.
 * This is a "behavior" component - it doesn't render anything visible.
 */

import { useEffect, useRef } from 'react';
import { useChat } from '../context/ChatContext';
import { useToolExecution } from '../hooks';
import { useSettings } from '../../settings';
import type { ChatToolCall } from '../types';

type WarningLevel = 'safe' | 'caution' | 'danger';

/**
 * Get warning level for a tool based on its annotations.
 */
function getWarningLevel(annotations: ChatToolCall['annotations']): WarningLevel {
  // No annotations = assume dangerous
  if (!annotations) return 'danger';

  // Read-only tools are safe
  if (annotations.readOnlyHint) return 'safe';

  // Check destructive and idempotent hints (with defaults per MCP spec)
  const isDestructive = annotations.destructiveHint !== false; // default true
  const isIdempotent = annotations.idempotentHint === true; // default false

  // Destructive, non-idempotent tools are dangerous
  if (isDestructive && !isIdempotent) return 'danger';

  // Non-destructive or idempotent tools are caution
  return 'caution';
}

/**
 * Check if a tool requires confirmation based on warning level.
 */
function requiresConfirmation(toolCall: ChatToolCall): boolean {
  return getWarningLevel(toolCall.annotations) === 'danger';
}

export function ToolExecutor() {
  const { state } = useChat();
  const { executeAllTools } = useToolExecution();
  const { confirmDangerousTools } = useSettings();
  const executingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Find messages that have finished streaming and have pending tool calls
    for (const message of state.messages) {
      // Skip if still streaming
      if (message.isStreaming) continue;

      // Skip if no tool calls
      if (!message.toolCalls || message.toolCalls.length === 0) continue;

      // Check if any tool calls are pending
      let pendingTools = message.toolCalls.filter((tc) => tc.status === 'pending');
      if (pendingTools.length === 0) continue;

      // If confirmDangerousTools is enabled, filter out dangerous tools
      if (confirmDangerousTools) {
        const autoApproveTools = pendingTools.filter((tc) => !requiresConfirmation(tc));
        const dangerousTools = pendingTools.filter((tc) => requiresConfirmation(tc));

        if (dangerousTools.length > 0) {
          console.log(
            '[ToolExecutor] Skipping dangerous tools (require confirmation):',
            dangerousTools.map((t) => t.displayName)
          );
        }

        pendingTools = autoApproveTools;
      }

      // Skip if no tools to execute after filtering
      if (pendingTools.length === 0) continue;

      // Skip if already executing this message's tools
      if (executingRef.current.has(message.id)) continue;

      // Mark as executing and run
      executingRef.current.add(message.id);
      console.log(
        '[ToolExecutor] Executing tools for message:',
        message.id,
        pendingTools.map((t) => t.displayName)
      );

      executeAllTools(message.id, pendingTools)
        .then((results) => {
          console.log('[ToolExecutor] Tools executed:', results);
          executingRef.current.delete(message.id);
        })
        .catch((err) => {
          console.error('[ToolExecutor] Error executing tools:', err);
          executingRef.current.delete(message.id);
        });
    }
  }, [state.messages, executeAllTools, confirmDangerousTools]);

  // This component doesn't render anything
  return null;
}
