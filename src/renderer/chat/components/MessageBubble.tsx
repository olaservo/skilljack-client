/**
 * Message Bubble Component
 *
 * Renders a single chat message with optional tool calls.
 */

import type { ChatMessage } from '../types';
import { ToolCallBlock } from './ToolCallBlock';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const roleLabel = message.role === 'user' ? 'You' : 'Assistant';

  return (
    <div
      className={`chat-message ${message.isStreaming ? 'chat-message-streaming' : ''}`}
      data-role={message.role}
    >
      <span className="visually-hidden">{roleLabel}:</span>
      <div className="chat-message-bubble">
        {message.content}
        {message.error && (
          <div className="chat-message-error">
            Error: {message.error}
          </div>
        )}
      </div>

      {/* Tool Calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="chat-message-tools">
          {message.toolCalls.map((toolCall) => (
            <ToolCallBlock key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      )}
    </div>
  );
}
