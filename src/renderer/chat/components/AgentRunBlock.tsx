/**
 * Agent Run Block Component
 *
 * Renders an AgentRunMessage in the chat — a container of ordered blocks
 * (text, tool calls, thinking, status) produced by the coding agent.
 */

import { memo, useState } from 'react';
import type { AgentRunMessage, AgentBlock, AgentToolBlock as AgentToolBlockType } from '../types';

/** Max characters to show for tool results before truncating */
const MAX_RESULT_LENGTH = 5000;

// ============================================
// Known tool display metadata
// ============================================

const KNOWN_TOOLS: Record<string, { label: string }> = {
  bash: { label: 'Shell' },
  read: { label: 'Read File' },
  edit: { label: 'Edit File' },
  write: { label: 'Write File' },
  grep: { label: 'Search' },
  find: { label: 'Find Files' },
  ls: { label: 'List Directory' },
};

// ============================================
// Main Component
// ============================================

interface AgentRunBlockProps {
  message: AgentRunMessage;
  onSteer?: (message: string) => void;
  onAbort?: () => void;
}

export function AgentRunBlock({ message, onSteer, onAbort }: AgentRunBlockProps) {
  return (
    <div className="agent-run-block" data-status={message.status}>
      {/* Header */}
      <div className="agent-run-header">
        <span className="agent-run-icon">
          {message.status === 'running' ? (
            <span className="agent-spinner" />
          ) : message.status === 'completed' ? (
            '\u2713'
          ) : (
            '\u2717'
          )}
        </span>
        <span className="agent-run-title">
          {message.title || 'Coding Agent'}
        </span>
        {message.model && (
          <span className="agent-run-model">
            {message.model.provider}/{message.model.id}
          </span>
        )}
        {message.status === 'running' && onAbort && (
          <button className="agent-abort-btn" onClick={onAbort} aria-label="Abort agent run">
            Abort
          </button>
        )}
      </div>

      {/* Task description */}
      <div className="agent-run-task">{message.task}</div>

      {/* Extension statuses */}
      {Object.entries(message.statuses).length > 0 && (
        <div className="agent-run-statuses">
          {Object.entries(message.statuses).map(([key, text]) => (
            <span key={key} className="agent-status-badge">
              {text}
            </span>
          ))}
        </div>
      )}

      {/* Interleaved blocks */}
      <div className="agent-run-blocks">
        {message.blocks.map((block) => (
          <AgentBlockRenderer
            key={block.type === 'tool' ? block.toolCallId : block.id}
            block={block}
          />
        ))}
      </div>

      {/* Footer: usage stats when complete */}
      {message.status === 'completed' && message.usage && (
        <div className="agent-run-footer">
          {message.usage.inputTokens + message.usage.outputTokens} tokens | $
          {message.usage.totalCost.toFixed(4)}
        </div>
      )}

      {/* Steer input (only while running) */}
      {message.status === 'running' && onSteer && <SteerInput onSubmit={onSteer} />}

      {/* Error display */}
      {message.status === 'error' && message.error && (
        <div className="agent-run-error">{message.error}</div>
      )}
    </div>
  );
}

// ============================================
// Block Renderer
// ============================================

const AgentBlockRenderer = memo(function AgentBlockRenderer({ block }: { block: AgentBlock }) {
  switch (block.type) {
    case 'text':
      return <div className="agent-block-text">{block.content}</div>;

    case 'thinking':
      return <AgentThinkingBlock content={block.content} />;

    case 'tool':
      return <AgentToolView block={block} />;

    case 'status':
      return <div className="agent-block-status">{block.message}</div>;
  }
});

// ============================================
// Thinking Block (collapsible)
// ============================================

function AgentThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="agent-block-thinking">
      <button
        className="agent-thinking-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Toggle thinking details"
      >
        {open ? '\u25BC' : '\u25B6'} Thinking...
      </button>
      {open && <div className="agent-thinking-content">{content}</div>}
    </div>
  );
}

// ============================================
// Tool View (dispatches to specialized views)
// ============================================

function AgentToolView({ block }: { block: AgentToolBlockType }) {
  const [open, setOpen] = useState(true);
  const toolMeta = KNOWN_TOOLS[block.toolName] ?? { label: block.toolName };

  return (
    <div className="agent-block-tool" data-status={block.status}>
      <button className="agent-tool-trigger" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Toggle ${toolMeta.label} details`}>
        <span className="agent-tool-name">{toolMeta.label}</span>
        <span className="agent-tool-status">
          {block.status === 'running' ? (
            <span className="agent-spinner" />
          ) : block.status === 'completed' ? (
            '\u2713'
          ) : (
            '\u2717'
          )}
        </span>
      </button>
      {open && (
        <div className="agent-tool-content">
          <AgentToolDetail block={block} />
        </div>
      )}
    </div>
  );
}

/** Pre block that truncates long content with a toggle */
function TruncatedPre({ content, className }: { content: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = content.length > MAX_RESULT_LENGTH;

  return (
    <>
      <pre className={className}>
        {truncated && !expanded ? content.slice(0, MAX_RESULT_LENGTH) + '\n... (truncated)' : content}
      </pre>
      {truncated && (
        <button
          className="agent-truncate-toggle"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Show less content' : 'Show more content'}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

function AgentToolDetail({ block }: { block: AgentToolBlockType }) {
  switch (block.toolName) {
    case 'bash':
      return (
        <div className="agent-tool-bash">
          <div className="bash-command">$ {String(block.args.command ?? '')}</div>
          {block.result && (
            <TruncatedPre className="bash-output" content={String(block.result.content ?? '')} />
          )}
        </div>
      );

    case 'edit':
      return (
        <div className="agent-tool-edit">
          <div className="edit-path">{String(block.args.file_path ?? block.args.path ?? '')}</div>
          {block.result && (
            <TruncatedPre className="edit-result" content={String(block.result.content ?? '')} />
          )}
        </div>
      );

    case 'read':
      return (
        <div className="agent-tool-read">
          <div className="read-path">{String(block.args.file_path ?? block.args.path ?? '')}</div>
          {block.args.offset && (
            <span className="read-range">
              lines {String(block.args.offset)}-
              {String(Number(block.args.offset) + Number(block.args.limit || 2000))}
            </span>
          )}
        </div>
      );

    case 'write':
      return (
        <div className="agent-tool-write">
          <div className="write-path">{String(block.args.file_path ?? block.args.path ?? '')}</div>
          <span className="write-size">
            {String(block.args.content ?? '').length} bytes
          </span>
        </div>
      );

    case 'grep':
      return (
        <div className="agent-tool-grep">
          <div className="grep-pattern">{String(block.args.pattern ?? '')}</div>
          {block.args.path && (
            <span className="grep-path">in {String(block.args.path)}</span>
          )}
          {block.result && (
            <TruncatedPre className="grep-result" content={String(block.result.content ?? '')} />
          )}
        </div>
      );

    case 'find':
    case 'ls':
      return (
        <div className="agent-tool-generic">
          <pre className="tool-args">{JSON.stringify(block.args, null, 2)}</pre>
          {block.result && (
            <TruncatedPre className="tool-result" content={String(block.result.content ?? '')} />
          )}
        </div>
      );

    default:
      // Generic view for unknown/dynamic tools
      return (
        <div className="agent-tool-generic">
          <div className="tool-name-label">{block.toolName}</div>
          <pre className="tool-args">{JSON.stringify(block.args, null, 2)}</pre>
          {block.result && (
            <TruncatedPre
              className="tool-result"
              content={
                typeof block.result.content === 'string'
                  ? block.result.content
                  : JSON.stringify(block.result.content, null, 2)
              }
            />
          )}
        </div>
      );
  }
}

// ============================================
// Steer Input
// ============================================

function SteerInput({ onSubmit }: { onSubmit: (msg: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="agent-steer-input"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) {
          onSubmit(value);
          setValue('');
        }
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Steer the agent..."
      />
      <button type="submit">Send</button>
    </form>
  );
}
