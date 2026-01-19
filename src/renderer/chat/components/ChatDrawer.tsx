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
import { SettingsDialog } from '../../settings';

// Icons
const TerminalIcon = () => <span style={{ fontWeight: 600 }}>&gt;_</span>;

const MinimizeIcon = () => (
  <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

interface ChatDrawerProps {
  /** When true, drawer is always open and fills the window (for Electron mode) */
  alwaysOpen?: boolean;
}

export function ChatDrawer({ alwaysOpen = false }: ChatDrawerProps) {
  const { state, toggleDrawer, closeDrawer } = useChat();
  const [height, setHeight] = useState(400);
  const drawerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // In alwaysOpen mode, use full height
  const isOpen = alwaysOpen || state.isOpen;
  const drawerHeight = alwaysOpen ? '100%' : (isOpen ? height : 0);

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
        className={`chat-drawer ${alwaysOpen ? 'always-open' : ''}`}
        data-state={isOpen ? 'open' : 'closed'}
        style={{ height: drawerHeight }}
        role="dialog"
        aria-label="Chat drawer"
        aria-hidden={!isOpen}
      >
        {/* Resize Handle (hidden in always-open mode) */}
        {!alwaysOpen && (
          <div
            className="chat-drawer-resize"
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize chat drawer"
          />
        )}

        {/* Header */}
        <div className="chat-drawer-header">
          <div className="chat-drawer-title">
            <TerminalIcon />
            <span>Terminal</span>
            <ServerStatus servers={state.servers} />
          </div>
          <div className="chat-drawer-actions">
            <SettingsDialog />
            <ThemeToggle />
            {!alwaysOpen && (
              <button
                className="chat-header-button"
                onClick={closeDrawer}
                aria-label="Minimize chat"
                title="Minimize (Esc)"
              >
                <MinimizeIcon />
              </button>
            )}
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
