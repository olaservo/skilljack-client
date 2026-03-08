/**
 * Chat Output Component
 *
 * Scrollable area that displays chat messages.
 * Auto-scrolls to bottom on new messages.
 * Routes messages to appropriate renderers based on type.
 */

import { useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';
import { isTextMessage } from '../types';
import { MessageBubble } from './MessageBubble';
import { AgentRunBlock } from './AgentRunBlock';

interface ChatOutputProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  onAgentSteer?: (message: string) => void;
  onAgentAbort?: () => void;
}

export function ChatOutput({ messages, isProcessing, onAgentSteer, onAgentAbort }: ChatOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);

  // Track if user has scrolled up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // Allow 50px tolerance for "at bottom"
    shouldScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  // Auto-scroll on new messages
  useEffect(() => {
    if (shouldScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={containerRef}
      className="chat-output"
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
    >
      {messages.length === 0 ? (
        <div className="chat-empty">
          <p className="chat-empty-title">Terminal Ready</p>
          <p className="chat-empty-hint">
            Type a message to interact with connected MCP servers.
          </p>
        </div>
      ) : (
        messages.map((message) => {
          if (isTextMessage(message)) {
            return <MessageBubble key={message.id} message={message} />;
          }
          return (
            <AgentRunBlock
              key={message.id}
              message={message}
              onSteer={message.status === 'running' ? onAgentSteer : undefined}
              onAbort={message.status === 'running' ? onAgentAbort : undefined}
            />
          );
        })
      )}

      {isProcessing && !messages.some((m) => isTextMessage(m) && m.isStreaming) && (
        <div className="chat-typing">
          <span className="chat-typing-dot" />
          <span className="chat-typing-dot" />
          <span className="chat-typing-dot" />
        </div>
      )}
    </div>
  );
}
