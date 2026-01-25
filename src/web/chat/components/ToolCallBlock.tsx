/**
 * Tool Call Block Component
 *
 * Displays a tool call with collapsible arguments and result.
 * Shows annotation badges based on declared MCP tool annotations.
 * Provides a Run button for pending tools that require confirmation.
 */

import { useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import type { ChatToolCall } from '../types';
import { useToolExecution } from '../hooks';

interface ToolCallBlockProps {
  toolCall: ChatToolCall;
  messageId: string;
}

interface AnnotationBadge {
  label: string;
  className: string;
  title: string;
}

/**
 * Get annotation badges for a tool based on its declared annotations.
 */
function getAnnotationBadges(annotations: ChatToolCall['annotations']): AnnotationBadge[] {
  if (!annotations) return [];

  const badges: AnnotationBadge[] = [];

  if (annotations.readOnlyHint === true) {
    badges.push({
      label: 'Read-only',
      className: 'annotation-readonly',
      title: 'Does not modify data or state',
    });
  }

  if (annotations.destructiveHint === true) {
    badges.push({
      label: 'Destructive',
      className: 'annotation-destructive',
      title: 'May delete or overwrite data',
    });
  }

  if (annotations.idempotentHint === true) {
    badges.push({
      label: 'Idempotent',
      className: 'annotation-idempotent',
      title: 'Running multiple times has the same effect',
    });
  }

  if (annotations.openWorldHint === true) {
    badges.push({
      label: 'External',
      className: 'annotation-external',
      title: 'Interacts with external systems',
    });
  }

  return badges;
}

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    className="icon-sm"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 150ms ease',
    }}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const statusLabels: Record<ChatToolCall['status'], string> = {
  pending: 'Pending',
  executing: 'Running',
  completed: 'Done',
  failed: 'Failed',
};

export function ToolCallBlock({ toolCall, messageId }: ToolCallBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { executeTool } = useToolExecution();

  const hasContent =
    Object.keys(toolCall.arguments).length > 0 ||
    toolCall.result !== undefined;

  const annotationBadges = getAnnotationBadges(toolCall.annotations);
  const isPending = toolCall.status === 'pending';

  const handleRun = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't toggle collapsible
    executeTool(messageId, toolCall);
  };

  return (
    <Collapsible.Root
      className="tool-call"
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      <Collapsible.Trigger asChild>
        <button className="tool-call-header" disabled={!hasContent}>
          <ChevronIcon open={isOpen} />
          <span className="tool-call-name">{toolCall.displayName}</span>
          <span className="tool-call-server">{toolCall.serverName}</span>
          {annotationBadges.map((badge) => (
            <span
              key={badge.className}
              className={`tool-annotation-badge ${badge.className}`}
              title={badge.title}
            >
              {badge.label}
            </span>
          ))}
          <span className="tool-call-status" data-status={toolCall.status}>
            {statusLabels[toolCall.status]}
          </span>
          {isPending && (
            <button
              className="tool-call-run-btn"
              onClick={handleRun}
              title="Run this tool"
            >
              Run
            </button>
          )}
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content className="tool-call-content">
        {Object.keys(toolCall.arguments).length > 0 && (
          <div className="tool-call-section">
            <div className="tool-call-section-label">Arguments:</div>
            <pre>{JSON.stringify(toolCall.arguments, null, 2)}</pre>
          </div>
        )}

        {toolCall.result !== undefined && (
          <div className="tool-call-section">
            <div className="tool-call-section-label">
              {toolCall.result.isError ? 'Error:' : 'Result:'}
            </div>
            <pre
              className={toolCall.result.isError ? 'tool-call-error' : ''}
            >
              {typeof toolCall.result.content === 'string'
                ? toolCall.result.content
                : JSON.stringify(toolCall.result.content, null, 2)}
            </pre>
          </div>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
