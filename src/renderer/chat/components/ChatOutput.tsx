/**
 * Chat Output Component
 *
 * Scrollable area that displays chat messages.
 * Auto-scrolls to bottom on new messages.
 */

import { useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';
import { MessageBubble } from './MessageBubble';
import { PlanBlock } from './PlanBlock';
import { AcpPermissionCard } from './AcpPermissionCard';
import { useChat } from '../context/ChatContext';

interface ChatOutputProps {
  messages: ChatMessage[];
  isProcessing: boolean;
}

export function ChatOutput({ messages, isProcessing }: ChatOutputProps) {
  const { state } = useChat();
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);
  const acpPlan = state.acpSession?.plan;
  const activePermission = state.acpSession?.activePermission;

  // Track if user has scrolled up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // Allow 50px tolerance for "at bottom"
    shouldScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  // Auto-scroll on new messages (and when a permission card appears)
  useEffect(() => {
    if (shouldScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, activePermission]);

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
        messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))
      )}

      {acpPlan && acpPlan.length > 0 && <PlanBlock entries={acpPlan} />}

      {activePermission && <AcpPermissionCard />}

      {isProcessing && !messages.some((m) => m.isStreaming) && (
        <div className="chat-typing">
          <span className="chat-typing-dot" />
          <span className="chat-typing-dot" />
          <span className="chat-typing-dot" />
        </div>
      )}
    </div>
  );
}
