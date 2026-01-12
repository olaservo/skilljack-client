/**
 * Chat Context
 *
 * Manages chat state using useReducer pattern.
 * Provides hooks for components to access and update chat state.
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
  type Dispatch,
} from 'react';
import type {
  ChatState,
  ChatAction,
  ChatMessage,
  ChatToolCall,
  ServerInfo,
  McpTool,
} from '../types';

// ============================================
// Initial State
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const initialState: ChatState = {
  isOpen: false,
  sessionId: generateSessionId(),
  messages: [],
  inputValue: '',
  inputHistory: [],
  historyIndex: -1,
  isProcessing: false,
  streamingMessageId: null,
  servers: [],
  tools: [],
  activeServers: null,
  error: null,
};

// ============================================
// Reducer
// ============================================

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'TOGGLE_DRAWER':
      return { ...state, isOpen: !state.isOpen };

    case 'OPEN_DRAWER':
      return { ...state, isOpen: true };

    case 'CLOSE_DRAWER':
      return { ...state, isOpen: false };

    case 'SET_INPUT':
      return { ...state, inputValue: action.value, historyIndex: -1 };

    case 'ADD_TO_HISTORY':
      if (!action.value.trim()) return state;
      // Avoid duplicates at the end
      if (state.inputHistory[state.inputHistory.length - 1] === action.value) {
        return state;
      }
      return {
        ...state,
        inputHistory: [...state.inputHistory, action.value].slice(-50), // Keep last 50
        historyIndex: -1,
      };

    case 'NAVIGATE_HISTORY': {
      const { inputHistory, historyIndex, inputValue } = state;
      if (inputHistory.length === 0) return state;

      if (action.direction === 'up') {
        const newIndex = historyIndex === -1
          ? inputHistory.length - 1
          : Math.max(0, historyIndex - 1);
        return {
          ...state,
          historyIndex: newIndex,
          inputValue: inputHistory[newIndex] || '',
        };
      } else {
        if (historyIndex === -1) return state;
        const newIndex = historyIndex + 1;
        if (newIndex >= inputHistory.length) {
          return { ...state, historyIndex: -1, inputValue: '' };
        }
        return {
          ...state,
          historyIndex: newIndex,
          inputValue: inputHistory[newIndex] || '',
        };
      }
    }

    case 'ADD_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.message],
      };

    case 'UPDATE_MESSAGE':
      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === action.id ? { ...msg, ...action.updates } : msg
        ),
      };

    case 'APPEND_STREAM':
      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === action.id
            ? { ...msg, content: msg.content + action.content }
            : msg
        ),
      };

    case 'UPDATE_TOOL_CALL':
      return {
        ...state,
        messages: state.messages.map((msg) => {
          if (msg.id !== action.messageId || !msg.toolCalls) return msg;
          return {
            ...msg,
            toolCalls: msg.toolCalls.map((tc) =>
              tc.id === action.toolCallId ? { ...tc, ...action.updates } : tc
            ),
          };
        }),
      };

    case 'SET_PROCESSING':
      return { ...state, isProcessing: action.isProcessing };

    case 'SET_STREAMING_MESSAGE':
      return { ...state, streamingMessageId: action.id };

    case 'SET_SERVERS':
      return { ...state, servers: action.servers };

    case 'SET_TOOLS':
      return { ...state, tools: action.tools };

    case 'FILTER_SERVERS':
      return { ...state, activeServers: action.serverNames };

    case 'SET_ERROR':
      return { ...state, error: action.error };

    case 'CLEAR_MESSAGES':
      return { ...state, messages: [] };

    case 'NEW_SESSION':
      return {
        ...state,
        sessionId: generateSessionId(),
        messages: [],
        error: null,
      };

    default:
      return state;
  }
}

// ============================================
// Context
// ============================================

interface ChatContextValue {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  // Convenience actions
  toggleDrawer: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  setInput: (value: string) => void;
  sendMessage: (content: string) => void;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => ChatMessage;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  appendStream: (id: string, content: string) => void;
  updateToolCall: (messageId: string, toolCallId: string, updates: Partial<ChatToolCall>) => void;
  navigateHistory: (direction: 'up' | 'down') => void;
  clearMessages: () => void;
  newSession: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

// ============================================
// Provider
// ============================================

interface ChatProviderProps {
  children: ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  // Convenience action creators
  const toggleDrawer = useCallback(() => dispatch({ type: 'TOGGLE_DRAWER' }), []);
  const openDrawer = useCallback(() => dispatch({ type: 'OPEN_DRAWER' }), []);
  const closeDrawer = useCallback(() => dispatch({ type: 'CLOSE_DRAWER' }), []);
  const setInput = useCallback((value: string) => dispatch({ type: 'SET_INPUT', value }), []);
  const navigateHistory = useCallback(
    (direction: 'up' | 'down') => dispatch({ type: 'NAVIGATE_HISTORY', direction }),
    []
  );
  const clearMessages = useCallback(() => dispatch({ type: 'CLEAR_MESSAGES' }), []);
  const newSession = useCallback(() => dispatch({ type: 'NEW_SESSION' }), []);

  const addMessage = useCallback(
    (message: Omit<ChatMessage, 'id' | 'timestamp'>): ChatMessage => {
      const fullMessage: ChatMessage = {
        ...message,
        id: generateId(),
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_MESSAGE', message: fullMessage });
      return fullMessage;
    },
    []
  );

  const updateMessage = useCallback(
    (id: string, updates: Partial<ChatMessage>) => {
      dispatch({ type: 'UPDATE_MESSAGE', id, updates });
    },
    []
  );

  const appendStream = useCallback(
    (id: string, content: string) => {
      dispatch({ type: 'APPEND_STREAM', id, content });
    },
    []
  );

  const updateToolCall = useCallback(
    (messageId: string, toolCallId: string, updates: Partial<ChatToolCall>) => {
      dispatch({ type: 'UPDATE_TOOL_CALL', messageId, toolCallId, updates });
    },
    []
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || state.isProcessing) return;

      // Add user message
      dispatch({ type: 'ADD_TO_HISTORY', value: content });
      dispatch({ type: 'SET_INPUT', value: '' });
      const userMsg = addMessage({ role: 'user', content });

      // Create assistant message placeholder
      const assistantMsg = addMessage({ role: 'assistant', content: '', isStreaming: true });
      dispatch({ type: 'SET_PROCESSING', isProcessing: true });
      dispatch({ type: 'SET_STREAMING_MESSAGE', id: assistantMsg.id });

      try {
        // Build chat messages for API
        const chatMessages = state.messages
          .filter((m) => m.role !== 'system' && m.content.trim())
          .map((m) => ({ role: m.role, content: m.content }));
        chatMessages.push({ role: 'user', content });

        // Build MCP context
        const mcpContext = {
          servers: state.servers.map((s) => ({ name: s.name, version: s.version })),
          availableTools: state.tools,
        };

        // Call streaming API
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: state.sessionId,
            messages: chatMessages,
            mcpContext,
            settings: {
              provider: 'anthropic',
              modelId: 'claude-sonnet-4-5-20250929',
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Read SSE stream
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        const toolCalls: ChatToolCall[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const chunk = JSON.parse(data);

                switch (chunk.type) {
                  case 'text':
                    if (chunk.content) {
                      dispatch({ type: 'APPEND_STREAM', id: assistantMsg.id, content: chunk.content });
                    }
                    break;
                  case 'tool_call_start':
                    if (chunk.toolCall) {
                      toolCalls.push({
                        id: chunk.toolCall.id,
                        name: chunk.toolCall.name,
                        displayName: chunk.toolCall.displayName || chunk.toolCall.name,
                        serverName: chunk.toolCall.serverName || 'default',
                        arguments: chunk.toolCall.arguments || {},
                        status: 'pending',
                      });
                    }
                    break;
                  case 'error':
                    dispatch({ type: 'SET_ERROR', error: chunk.message });
                    break;
                  case 'done':
                    // Stream complete
                    break;
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        // Finalize message
        dispatch({
          type: 'UPDATE_MESSAGE',
          id: assistantMsg.id,
          updates: {
            isStreaming: false,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          },
        });
      } catch (err) {
        console.error('[Chat] Error:', err);
        dispatch({
          type: 'UPDATE_MESSAGE',
          id: assistantMsg.id,
          updates: {
            isStreaming: false,
            content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        });
        dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : 'Unknown error' });
      } finally {
        dispatch({ type: 'SET_PROCESSING', isProcessing: false });
        dispatch({ type: 'SET_STREAMING_MESSAGE', id: null });
      }
    },
    [state.isProcessing, state.messages, state.servers, state.tools, state.sessionId, addMessage]
  );

  // Keyboard shortcut: Cmd/Ctrl+K to toggle
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleDrawer();
      }
      if (e.key === 'Escape' && state.isOpen) {
        closeDrawer();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.isOpen, toggleDrawer, closeDrawer]);

  // Fetch servers and tools on mount
  useEffect(() => {
    async function fetchMcpContext() {
      try {
        // Fetch servers
        const serversRes = await fetch('/api/servers');
        if (serversRes.ok) {
          const data = await serversRes.json();
          const servers: ServerInfo[] = data.servers?.map((s: { name: string; toolCount: number; version?: string }) => ({
            name: s.name,
            version: s.version,
            status: 'connected' as const,
            toolCount: s.toolCount,
          })) || [];
          dispatch({ type: 'SET_SERVERS', servers });
        }

        // Fetch tools
        const toolsRes = await fetch('/api/tools');
        if (toolsRes.ok) {
          const data = await toolsRes.json();
          const tools: McpTool[] = data.tools?.map((t: { name: string; originalName?: string; serverName?: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
            name: t.name,
            originalName: t.originalName || t.name,
            serverName: t.serverName || 'default',
            description: t.description,
            inputSchema: t.inputSchema,
          })) || [];
          dispatch({ type: 'SET_TOOLS', tools });
        }
      } catch (err) {
        console.error('[Chat] Failed to fetch MCP context:', err);
      }
    }

    fetchMcpContext();
  }, []);

  const value: ChatContextValue = {
    state,
    dispatch,
    toggleDrawer,
    openDrawer,
    closeDrawer,
    setInput,
    sendMessage,
    addMessage,
    updateMessage,
    appendStream,
    updateToolCall,
    navigateHistory,
    clearMessages,
    newSession,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

// ============================================
// Hook
// ============================================

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
