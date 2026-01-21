/**
 * Chat Input Component
 *
 * Textarea with send button.
 * Features:
 * - Auto-resize textarea
 * - History navigation (Arrow Up/Down)
 * - Enter to send, Shift+Enter for newline
 */

import { useRef, useCallback, useEffect } from 'react';
import { useChat } from '../context/ChatContext';

const SendIcon = () => (
  <svg className="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

export function ChatInput() {
  const { state, setInput, sendMessage, navigateHistory } = useChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on mount (for Electron alwaysOpen mode)
  useEffect(() => {
    // Small delay to ensure app has fully rendered
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  }, []);

  // Auto-focus textarea when drawer opens (for web mode)
  useEffect(() => {
    if (state.isOpen && textareaRef.current) {
      // Small delay to ensure drawer animation has started
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [state.isOpen]);

  // Refocus textarea when processing completes
  // Track previous processing state to detect completion transition
  const wasProcessingRef = useRef(state.isProcessing);
  useEffect(() => {
    const wasProcessing = wasProcessingRef.current;
    wasProcessingRef.current = state.isProcessing;

    // Only refocus when transitioning from processing to not processing
    // Note: Don't check state.isOpen because in Electron alwaysOpen mode it's false
    if (wasProcessing && !state.isProcessing) {
      // Use requestAnimationFrame + timeout to ensure we focus after React settles
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (textareaRef.current && document.activeElement !== textareaRef.current) {
            textareaRef.current.focus();
          }
        }, 100);
      });
    }
  }, [state.isProcessing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter to send (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (state.inputValue.trim() && !state.isProcessing) {
          sendMessage(state.inputValue);
        }
        return;
      }

      // Arrow Up/Down for history (only when at boundaries)
      if (e.key === 'ArrowUp' && textareaRef.current) {
        const { selectionStart, selectionEnd, value } = textareaRef.current;
        // Only navigate if cursor is at start
        if (selectionStart === 0 && selectionEnd === 0) {
          e.preventDefault();
          navigateHistory('up');
        }
        return;
      }

      if (e.key === 'ArrowDown' && textareaRef.current) {
        const { selectionStart, selectionEnd, value } = textareaRef.current;
        // Only navigate if cursor is at end
        if (selectionStart === value.length && selectionEnd === value.length) {
          e.preventDefault();
          navigateHistory('down');
        }
        return;
      }
    },
    [state.inputValue, state.isProcessing, sendMessage, navigateHistory]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);

      // Auto-resize
      const textarea = e.target;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    },
    [setInput]
  );

  const handleSend = useCallback(() => {
    if (state.inputValue.trim() && !state.isProcessing) {
      sendMessage(state.inputValue);
    }
  }, [state.inputValue, state.isProcessing, sendMessage]);

  return (
    <div className="chat-input-area">
      <div className="chat-input-wrapper">
        <span className="chat-input-prompt">&gt;</span>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={state.inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={state.isProcessing}
          rows={1}
          aria-label="Chat message input"
        />
        <button
          className="chat-send-button"
          onClick={handleSend}
          disabled={!state.inputValue.trim() || state.isProcessing}
          aria-label="Send message"
          title="Send message (Enter)"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
