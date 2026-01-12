/**
 * Chat Drawer Component
 *
 * Bottom-panel drawer that contains the chat interface.
 * Features:
 * - Resizable height via drag handle
 * - Toggle button when closed
 * - Server status indicators
 * - Theme-aware styling
 */

import { useState, useRef, useCallback } from 'react';
import { useChat } from '../context/ChatContext';
import { ChatOutput } from './ChatOutput';
import { ChatInput } from './ChatInput';
import { ServerStatus } from './ServerStatus';
import { ThemeToggle } from './ThemeToggle';
import { ToolExecutor } from './ToolExecutor';

// Icons
const TerminalIcon = () => <span style={{ fontWeight: 600 }}>&gt;_</span>;

const MinimizeIcon = () => (
  <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export function ChatDrawer() {
  const { state, toggleDrawer, closeDrawer } = useChat();
  const [height, setHeight] = useState(400);
  const drawerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startY.current = 'touches' in e ? e.touches[0].clientY : e.clientY;
    startHeight.current = height;

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      if (!isDragging.current) return;
      const currentY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY;
      const delta = startY.current - currentY;
      const newHeight = Math.min(Math.max(200, startHeight.current + delta), window.innerHeight - 100);
      setHeight(newHeight);
    };

    const handleEnd = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('touchend', handleEnd);
  }, [height]);

  return (
    <>
      {/* Drawer */}
      <div
        ref={drawerRef}
        className="chat-drawer"
        data-state={state.isOpen ? 'open' : 'closed'}
        style={{ height: state.isOpen ? height : 0 }}
        role="dialog"
        aria-label="Chat drawer"
        aria-hidden={!state.isOpen}
      >
        {/* Resize Handle */}
        <div
          className="chat-drawer-resize"
          onMouseDown={handleResizeStart}
          onTouchStart={handleResizeStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize chat drawer"
        />

        {/* Header */}
        <div className="chat-drawer-header">
          <div className="chat-drawer-title">
            <TerminalIcon />
            <span>Terminal</span>
            <ServerStatus servers={state.servers} />
          </div>
          <div className="chat-drawer-actions">
            <ThemeToggle />
            <button
              className="chat-header-button"
              onClick={closeDrawer}
              aria-label="Minimize chat"
              title="Minimize (Esc)"
            >
              <MinimizeIcon />
            </button>
          </div>
        </div>

        {/* Content */}
        <ChatOutput messages={state.messages} isProcessing={state.isProcessing} />
        <ChatInput />

        {/* Tool execution handler (renders nothing) */}
        <ToolExecutor />
      </div>
    </>
  );
}
