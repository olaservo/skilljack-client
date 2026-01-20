/**
 * Tool Call Block Component
 *
 * Displays a tool call with collapsible arguments and result.
 */

import { useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import type { ChatToolCall } from '../types';

interface ToolCallBlockProps {
  toolCall: ChatToolCall;
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

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasContent =
    Object.keys(toolCall.arguments).length > 0 ||
    toolCall.result !== undefined;

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
          <span className="tool-call-status" data-status={toolCall.status}>
            {statusLabels[toolCall.status]}
          </span>
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
