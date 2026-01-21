/**
 * Chat Context
 *
 * Manages chat state using useReducer pattern.
 * Provides hooks for components to access and update chat state.
 *
 * Uses CommunicationAdapter for environment-agnostic backend communication
 * (HTTP in web mode, IPC in Electron mode).
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
  MessageModelConfig,
} from '../types';
import { useSettings } from '../../settings';
import { useCommunication } from '../../hooks/useCommunication';
import type { StreamEvent } from '../../../shared/types';

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
  currentTurn: 0,
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
      const { inputHistory, historyIndex } = state;
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

    case 'UPDATE_SERVER_STATUS':
      return {
        ...state,
        servers: state.servers.map((server) =>
          server.name === action.serverName
            ? { ...server, ...action.updates }
            : server
        ),
      };

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
        currentTurn: 0,
      };

    case 'INCREMENT_TURN':
      return { ...state, currentTurn: state.currentTurn + 1 };

    case 'RESET_TURN':
      return { ...state, currentTurn: 0 };

    case 'APPEND_TOOL_CALLS':
      return {
        ...state,
        messages: state.messages.map((msg) => {
          if (msg.id !== action.messageId) return msg;
          const existingToolCalls = msg.toolCalls || [];
          return {
            ...msg,
            toolCalls: [...existingToolCalls, ...action.toolCalls],
          };
        }),
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
  /** Continue the conversation after tools have been executed */
  continueAfterTools: (messageId: string) => Promise<void>;
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
  const { doer, dreamer } = useSettings();
  const adapter = useCommunication();

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

      // Parse slash commands for model selection (Doer vs Dreamer)
      let modelRole: 'doer' | 'dreamer' = 'doer';
      let processedContent = content.trim();

      if (processedContent.startsWith('/dream ')) {
        modelRole = 'dreamer';
        processedContent = processedContent.slice(7).trim();
      } else if (processedContent === '/dream') {
        // Just "/dream" with no content - show help
        addMessage({
          role: 'system',
          content: 'Usage: `/dream <your question>` - Use the Dreamer model for complex reasoning.',
        });
        return;
      }

      // Select model config based on role
      const modelConfig = modelRole === 'dreamer' ? dreamer : doer;

      // Add user message (show original content including /dream prefix)
      dispatch({ type: 'ADD_TO_HISTORY', value: content });
      dispatch({ type: 'SET_INPUT', value: '' });
      dispatch({ type: 'RESET_TURN' }); // Reset turn counter for new user message
      addMessage({ role: 'user', content });

      // Create assistant message placeholder with model config for continuation
      const msgModelConfig: MessageModelConfig = {
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        temperature: modelConfig.temperature,
        maxTurns: modelConfig.maxTurns,
      };
      const assistantMsg = addMessage({
        role: 'assistant',
        content: '',
        isStreaming: true,
        modelConfig: msgModelConfig,
      });
      dispatch({ type: 'SET_PROCESSING', isProcessing: true });
      dispatch({ type: 'SET_STREAMING_MESSAGE', id: assistantMsg.id });

      try {
        // Build chat messages for API in AI SDK format
        // This properly includes tool calls and results for conversation context
        const chatMessages: Array<{
          role: 'user' | 'assistant' | 'tool';
          content: string | Array<{ type: string; [key: string]: unknown }>;
        }> = [];

        for (const m of state.messages) {
          if (m.role === 'system') continue;

          if (m.role === 'user') {
            // User messages are simple text
            if (m.content.trim()) {
              chatMessages.push({ role: 'user', content: m.content });
            }
          } else if (m.role === 'assistant') {
            // Assistant messages may have text and/or tool calls
            const hasToolCalls = m.toolCalls && m.toolCalls.length > 0;
            const hasText = m.content.trim();

            if (!hasText && !hasToolCalls) continue;

            if (hasToolCalls) {
              // Only include tool calls that have results (API requires tool_result for every tool_use)
              const completedCalls = m.toolCalls!.filter((tc) => tc.result);

              // Build content array with text and completed tool calls only
              const contentParts: Array<{ type: string; [key: string]: unknown }> = [];

              if (hasText) {
                contentParts.push({ type: 'text', text: m.content });
              }

              for (const tc of completedCalls) {
                contentParts.push({
                  type: 'tool-call',
                  toolCallId: tc.id,
                  toolName: tc.qualifiedName,
                  args: tc.arguments,
                });
              }

              // Only add assistant message if there's content
              if (contentParts.length > 0) {
                chatMessages.push({ role: 'assistant', content: contentParts });
              }

              // Add tool result message for completed calls
              if (completedCalls.length > 0) {
                const toolResults = completedCalls.map((tc) => ({
                  type: 'tool-result',
                  toolCallId: tc.id,
                  toolName: tc.qualifiedName,
                  result: tc.result!.content,
                  isError: tc.result!.isError,
                }));
                chatMessages.push({ role: 'tool', content: toolResults });
              }
            } else {
              // Text-only assistant message
              chatMessages.push({ role: 'assistant', content: m.content });
            }
          }
        }

        // Add current user message
        chatMessages.push({ role: 'user', content: processedContent });

        // Build MCP context
        const mcpContext = {
          servers: state.servers.map((s) => ({ name: s.name, version: s.version })),
          availableTools: state.tools,
        };

        // Use communication adapter for streaming chat
        const toolCalls: ChatToolCall[] = [];

        for await (const event of adapter.streamChat({
          sessionId: state.sessionId,
          messages: chatMessages,
          mcpContext,
          settings: {
            provider: modelConfig.provider,
            modelId: modelConfig.modelId,
            temperature: modelConfig.temperature,
            maxTurns: modelConfig.maxTurns,
          },
        })) {
          handleStreamEvent(event, assistantMsg.id, toolCalls, dispatch);
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
    [state.isProcessing, state.messages, state.servers, state.tools, state.sessionId, addMessage, doer, dreamer, adapter]
  );

  /**
   * Continue the conversation after tools have been executed.
   * This enables multi-turn tool workflows (e.g., list servers → enable server → confirm).
   * Appends to the existing assistant message rather than creating a new one.
   */
  const continueAfterTools = useCallback(
    async (messageId: string) => {
      // Find the message we're continuing from
      const message = state.messages.find((m) => m.id === messageId);
      if (!message || message.role !== 'assistant') {
        console.warn('[Chat] continueAfterTools: Invalid message', messageId);
        return;
      }

      // Skip if already processing
      if (state.isProcessing) {
        console.log('[Chat] continueAfterTools: Already processing, skipping');
        return;
      }

      // Check model config for maxTurns
      const msgModelConfig = message.modelConfig;
      if (!msgModelConfig) {
        console.log('[Chat] continueAfterTools: No model config, skipping');
        return;
      }

      // Check if we've exceeded maxTurns
      const nextTurn = state.currentTurn + 1;
      if (nextTurn >= msgModelConfig.maxTurns) {
        console.log(`[Chat] continueAfterTools: Max turns reached (${nextTurn}/${msgModelConfig.maxTurns})`);
        return;
      }

      // Check if any tools had errors - don't continue if so
      const hasErrors = message.toolCalls?.some((tc) => tc.result?.isError);
      if (hasErrors) {
        console.log('[Chat] continueAfterTools: Tool errors detected, stopping');
        return;
      }

      console.log(`[Chat] continueAfterTools: Continuing turn ${nextTurn}/${msgModelConfig.maxTurns}`);

      // Increment turn counter and set processing state
      dispatch({ type: 'INCREMENT_TURN' });
      dispatch({ type: 'SET_PROCESSING', isProcessing: true });
      dispatch({ type: 'UPDATE_MESSAGE', id: messageId, updates: { isStreaming: true } });
      dispatch({ type: 'SET_STREAMING_MESSAGE', id: messageId });

      try {
        // Build chat messages including the just-executed tool results
        const chatMessages: Array<{
          role: 'user' | 'assistant' | 'tool';
          content: string | Array<{ type: string; [key: string]: unknown }>;
        }> = [];

        for (const m of state.messages) {
          if (m.role === 'system') continue;

          if (m.role === 'user') {
            if (m.content.trim()) {
              chatMessages.push({ role: 'user', content: m.content });
            }
          } else if (m.role === 'assistant') {
            const hasToolCalls = m.toolCalls && m.toolCalls.length > 0;
            const hasText = m.content.trim();

            if (!hasText && !hasToolCalls) continue;

            if (hasToolCalls) {
              // Only include tool calls that have results (API requires tool_result for every tool_use)
              const completedCalls = m.toolCalls!.filter((tc) => tc.result);

              const contentParts: Array<{ type: string; [key: string]: unknown }> = [];

              if (hasText) {
                contentParts.push({ type: 'text', text: m.content });
              }

              for (const tc of completedCalls) {
                contentParts.push({
                  type: 'tool-call',
                  toolCallId: tc.id,
                  toolName: tc.qualifiedName,
                  args: tc.arguments,
                });
              }

              // Only add assistant message if there's content
              if (contentParts.length > 0) {
                chatMessages.push({ role: 'assistant', content: contentParts });
              }

              // Add tool result message for completed calls
              if (completedCalls.length > 0) {
                const toolResults = completedCalls.map((tc) => ({
                  type: 'tool-result',
                  toolCallId: tc.id,
                  toolName: tc.qualifiedName,
                  result: tc.result!.content,
                  isError: tc.result!.isError,
                }));
                chatMessages.push({ role: 'tool', content: toolResults });
              }
            } else {
              chatMessages.push({ role: 'assistant', content: m.content });
            }
          }
        }

        // Build MCP context
        const mcpContext = {
          servers: state.servers.map((s) => ({ name: s.name, version: s.version })),
          availableTools: state.tools,
        };

        // Stream continuation - append to existing message
        const newToolCalls: ChatToolCall[] = [];

        for await (const event of adapter.streamChat({
          sessionId: state.sessionId,
          messages: chatMessages,
          mcpContext,
          settings: {
            provider: msgModelConfig.provider,
            modelId: msgModelConfig.modelId,
            temperature: msgModelConfig.temperature,
            maxTurns: 1, // Single turn per continuation call
          },
        })) {
          handleStreamEvent(event, messageId, newToolCalls, dispatch);
        }

        // Finalize - append new tool calls to existing ones
        if (newToolCalls.length > 0) {
          dispatch({
            type: 'APPEND_TOOL_CALLS',
            messageId,
            toolCalls: newToolCalls,
          });
        }
        dispatch({
          type: 'UPDATE_MESSAGE',
          id: messageId,
          updates: { isStreaming: false },
        });
      } catch (err) {
        console.error('[Chat] continueAfterTools error:', err);
        dispatch({
          type: 'APPEND_STREAM',
          id: messageId,
          content: `\n\nError continuing: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
        dispatch({
          type: 'UPDATE_MESSAGE',
          id: messageId,
          updates: { isStreaming: false },
        });
      } finally {
        dispatch({ type: 'SET_PROCESSING', isProcessing: false });
        dispatch({ type: 'SET_STREAMING_MESSAGE', id: null });
      }
    },
    [state.isProcessing, state.messages, state.servers, state.tools, state.sessionId, state.currentTurn, adapter]
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

  // Auto-continue after tools complete (multi-turn workflow)
  // This watches for the last assistant message with completed tool calls
  useEffect(() => {
    // Skip if processing (already continuing or waiting for stream)
    if (state.isProcessing) return;

    // Find the last assistant message
    const lastAssistantMsg = [...state.messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistantMsg) return;

    // Skip if streaming
    if (lastAssistantMsg.isStreaming) return;

    // Skip if no tool calls
    if (!lastAssistantMsg.toolCalls || lastAssistantMsg.toolCalls.length === 0) return;

    // Check model config for multi-turn
    const modelConfig = lastAssistantMsg.modelConfig;
    if (!modelConfig || modelConfig.maxTurns <= 1) return;

    // Check if we've exceeded maxTurns
    if (state.currentTurn >= modelConfig.maxTurns - 1) {
      console.log(`[Chat] Auto-continue: Max turns reached (${state.currentTurn + 1}/${modelConfig.maxTurns})`);
      return;
    }

    // Check if all tool calls are completed (have results)
    const allCompleted = lastAssistantMsg.toolCalls.every((tc) => tc.status === 'completed' && tc.result);
    if (!allCompleted) return;

    // Check for errors - don't continue if any tool failed
    const hasErrors = lastAssistantMsg.toolCalls.some((tc) => tc.result?.isError);
    if (hasErrors) {
      console.log('[Chat] Auto-continue: Stopping due to tool errors');
      return;
    }

    console.log(`[Chat] Auto-continue: Triggering continuation (turn ${state.currentTurn + 1}/${modelConfig.maxTurns})`);
    continueAfterTools(lastAssistantMsg.id);
  }, [state.messages, state.isProcessing, state.currentTurn, continueAfterTools]);

  // Fetch servers and tools on mount using communication adapter
  useEffect(() => {
    async function fetchMcpContext() {
      try {
        // Fetch servers
        const serverData = await adapter.getServers();
        console.log('[Chat] Servers API response:', serverData);
        const servers: ServerInfo[] = serverData.map((s) => ({
          name: s.name,
          version: s.version,
          status: 'connected' as const,
          toolCount: s.toolCount,
        }));
        dispatch({ type: 'SET_SERVERS', servers });

        // Fetch tools
        const toolData = await adapter.getTools();
        console.log('[Chat] Tools API response:', toolData);
        const tools: McpTool[] = toolData.map((t) => ({
          name: t.name,
          originalName: t.displayName || t.name,
          serverName: t.serverName || 'default',
          description: t.description,
          inputSchema: t.inputSchema,
          hasUi: t.hasUi,
          uiResourceUri: t.uiResourceUri,
        }));
        console.log('[Chat] Processed tools:', tools.map(t => ({ name: t.name, serverName: t.serverName, hasUi: t.hasUi })));
        dispatch({ type: 'SET_TOOLS', tools });
      } catch (err) {
        console.error('[Chat] Failed to fetch MCP context:', err);
      }
    }

    fetchMcpContext();

    // Subscribe to real-time updates
    const unsubscribe = adapter.onEvent((event) => {
      if (event.type === 'tools_changed' || event.type === 'servers_changed') {
        fetchMcpContext();
      }

      // Handle lifecycle events for individual server status updates
      if (event.type === 'server_status_changed') {
        const { serverName, newStatus } = event.payload;
        dispatch({
          type: 'UPDATE_SERVER_STATUS',
          serverName,
          updates: { status: newStatus as ServerInfo['status'] },
        });
      }

      if (event.type === 'server_healthy') {
        const { serverName } = event.payload;
        dispatch({
          type: 'UPDATE_SERVER_STATUS',
          serverName,
          updates: {
            status: 'connected',
            healthChecksFailed: 0,
            lastError: undefined,
          },
        });
      }

      if (event.type === 'server_unhealthy') {
        const { serverName, error } = event.payload;
        dispatch({
          type: 'UPDATE_SERVER_STATUS',
          serverName,
          updates: {
            status: 'unhealthy',
            lastError: error,
          },
        });
      }

      if (event.type === 'server_crashed') {
        const { serverName, willRestart } = event.payload;
        dispatch({
          type: 'UPDATE_SERVER_STATUS',
          serverName,
          updates: {
            status: willRestart ? 'restarting' : 'failed',
          },
        });
      }

      if (event.type === 'server_restarting') {
        const { serverName, attempt, maxAttempts } = event.payload;
        dispatch({
          type: 'UPDATE_SERVER_STATUS',
          serverName,
          updates: {
            status: 'restarting',
            restartAttempts: attempt,
            maxRestartAttempts: maxAttempts,
          },
        });
      }
    });

    return unsubscribe;
  }, [adapter]);

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
    continueAfterTools,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

// ============================================
// Stream Event Handler
// ============================================

function handleStreamEvent(
  event: StreamEvent,
  messageId: string,
  toolCalls: ChatToolCall[],
  dispatch: Dispatch<ChatAction>
): void {
  switch (event.type) {
    case 'text':
      if (event.content) {
        dispatch({ type: 'APPEND_STREAM', id: messageId, content: event.content });
      }
      break;
    case 'tool_call_start':
      if (event.toolCall) {
        toolCalls.push({
          id: event.toolCall.id,
          qualifiedName: event.toolCall.name,
          displayName: event.toolCall.displayName || event.toolCall.name,
          serverName: event.toolCall.serverName || 'default',
          arguments: event.toolCall.arguments || {},
          status: 'pending',
        });
      }
      break;
    case 'error':
      dispatch({ type: 'SET_ERROR', error: event.message });
      break;
    case 'done':
      // Stream complete
      break;
  }
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
