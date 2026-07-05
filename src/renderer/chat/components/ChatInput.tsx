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

const StopIcon = () => (
  <svg className="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>
);

export function ChatInput() {
  const { state, setInput, sendMessage, navigateHistory, cancelAcpTurn } = useChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isAcp = state.backend.kind === 'acp';
  const permissionPending = !!state.acpSession?.activePermission;
  const acpPrompting = isAcp && state.acpSession?.status === 'prompting';
  const inputDisabled = state.isProcessing || permissionPending;

  // Slash-command suggestions advertised by the ACP agent
  const commandSuggestions =
    isAcp && state.inputValue.startsWith('/') && !state.inputValue.includes(' ')
      ? (state.acpSession?.availableCommands ?? []).filter((command) =>
          `/${command.name}`.startsWith(state.inputValue)
        )
      : [];

  // Auto-focus textarea on initial load
  useEffect(() => {
    const focusInput = () => {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    };

    // If document already loaded, focus now; otherwise wait for load
    if (document.readyState === 'complete') {
      focusInput();
    } else {
      window.addEventListener('load', focusInput);
      return () => window.removeEventListener('load', focusInput);
    }
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
        if (state.inputValue.trim() && !inputDisabled) {
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
    [state.inputValue, inputDisabled, sendMessage, navigateHistory]
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
    if (state.inputValue.trim() && !inputDisabled) {
      sendMessage(state.inputValue);
    }
  }, [state.inputValue, inputDisabled, sendMessage]);

  return (
    <div className="chat-input-area">
      {commandSuggestions.length > 0 && (
        <div className="chat-command-suggestions">
          {commandSuggestions.slice(0, 8).map((command) => (
            <button
              key={command.name}
              className="chat-command-suggestion"
              onClick={() => {
                setInput(`/${command.name} `);
                textareaRef.current?.focus();
              }}
            >
              <span className="chat-command-name">/{command.name}</span>
              {command.description && (
                <span className="chat-command-description">{command.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="chat-input-wrapper">
        <span className="chat-input-prompt">&gt;</span>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={state.inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            permissionPending
              ? 'Waiting for permission decision above…'
              : 'Type a message...'
          }
          disabled={inputDisabled}
          rows={1}
          aria-label="Chat message input"
        />
        {acpPrompting ? (
          <button
            className="chat-send-button chat-stop-button"
            onClick={cancelAcpTurn}
            aria-label="Stop agent"
            title="Stop the agent's current turn"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            className="chat-send-button"
            onClick={handleSend}
            disabled={!state.inputValue.trim() || inputDisabled}
            aria-label="Send message"
            title="Send message (Enter)"
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  );
}
