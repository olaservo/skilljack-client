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

/**
 * Get the reason why a tool requires confirmation.
 * Returns null if tool can be auto-executed.
 */
function getConfirmationReason(annotations: ChatToolCall['annotations']): string | null {
  // No annotations = require confirmation (unknown behavior)
  if (!annotations) {
    return 'no annotations provided (unknown behavior)';
  }

  // Read-only tools are safe - no confirmation needed
  if (annotations.readOnlyHint === true) {
    return null;
  }

  // Check destructive and idempotent hints (with defaults per MCP spec)
  const isDestructive = annotations.destructiveHint !== false; // default true if not explicitly false
  const isIdempotent = annotations.idempotentHint === true; // default false if not explicitly true

  // Destructive + non-idempotent = requires confirmation
  if (isDestructive && !isIdempotent) {
    const reasons: string[] = [];
    if (annotations.destructiveHint === true) {
      reasons.push('destructiveHint: true');
    } else if (annotations.destructiveHint === undefined) {
      reasons.push('destructiveHint: undefined (defaults to true)');
    }
    if (annotations.idempotentHint === false) {
      reasons.push('idempotentHint: false');
    } else if (annotations.idempotentHint === undefined) {
      reasons.push('idempotentHint: undefined (defaults to false)');
    }
    return reasons.join(', ');
  }

  // Non-destructive or idempotent tools can auto-execute
  return null;
}

/**
 * Check if a tool requires confirmation.
 */
function requiresConfirmation(toolCall: ChatToolCall): boolean {
  return getConfirmationReason(toolCall.annotations) !== null;
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
          console.log('[ToolExecutor] Tools requiring confirmation:');
          for (const tool of dangerousTools) {
            const reason = getConfirmationReason(tool.annotations);
            console.log(`  - ${tool.displayName}: ${reason}`);
          }
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
