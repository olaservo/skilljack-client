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
  useRef,
  type ReactNode,
  type Dispatch,
} from 'react';
import type {
  ChatState,
  ChatAction,
  ChatBackend,
  ChatMessage,
  ChatToolCall,
  ServerInfo,
  McpTool,
  MessageModelConfig,
} from '../types';
import { useSettings } from '../../settings';
import { useCommunication } from '../../hooks/useCommunication';
import type { StreamEvent, AnnotatedContentItem } from '../../../shared/types';
import type {
  AcpPermissionOutcome,
  AcpToolCallView,
  AcpUiEvent,
} from '../../../shared/acp-types';
import { isForAssistant } from '../../../shared/content-annotations.js';

// ============================================
// Initial State
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Filter tool result content by audience for LLM context.
 * Only includes content intended for the assistant/LLM.
 */
function filterContentForAssistant(content: unknown): unknown {
  // If not an array, return as-is (no annotations to filter)
  if (!Array.isArray(content)) {
    return content;
  }

  // Filter array items by audience
  const filtered = content.filter((item) => {
    // If item doesn't have annotations structure, include it (default: both audiences)
    if (typeof item !== 'object' || item === null) {
      return true;
    }
    const annotatedItem = item as AnnotatedContentItem;
    return isForAssistant(annotatedItem.annotations);
  });

  return filtered;
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
  backend: { kind: 'ai-sdk', role: 'doer' },
  acpSession: null,
};

// ============================================
// ACP Helpers
// ============================================

/** ACP statuses map so they never hit 'pending' — ToolExecutor must not auto-run them */
function mapAcpToolStatus(status: AcpToolCallView['status']): ChatToolCall['status'] {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'executing';
  }
}

function acpToolCallToChat(view: AcpToolCallView, agentName: string): ChatToolCall {
  return {
    id: view.toolCallId,
    qualifiedName: view.title || view.kind,
    displayName: view.title || view.kind,
    serverName: agentName,
    arguments:
      view.rawInput && typeof view.rawInput === 'object'
        ? (view.rawInput as Record<string, unknown>)
        : {},
    status: mapAcpToolStatus(view.status),
    acp: view,
  };
}

/** Finalize the streaming ACP message and reset processing flags */
function finalizeAcpTurn(
  state: ChatState,
  suffix: string | null,
  sessionStatus: 'ready' | 'dead'
): ChatState {
  const msgId = state.streamingMessageId;
  return {
    ...state,
    messages: msgId
      ? state.messages.map((msg) =>
          msg.id === msgId
            ? {
                ...msg,
                isStreaming: false,
                content: suffix ? msg.content + suffix : msg.content,
              }
            : msg
        )
      : state.messages,
    isProcessing: false,
    streamingMessageId: null,
    acpSession: state.acpSession ? { ...state.acpSession, status: sessionStatus } : null,
  };
}

function applyAcpEvent(state: ChatState, event: AcpUiEvent): ChatState {
  const session = state.acpSession;
  if (!session) return state;
  const msgId = state.streamingMessageId;
  const agentName = state.backend.kind === 'acp' ? state.backend.agentName : 'agent';

  switch (event.type) {
    case 'turn_started':
      return { ...state, acpSession: { ...session, status: 'prompting' } };

    case 'agent_chunk':
      if (!msgId) return state;
      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === msgId ? { ...msg, content: msg.content + event.text } : msg
        ),
      };

    case 'thought_chunk':
      if (!msgId) return state;
      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === msgId
            ? { ...msg, thoughtContent: (msg.thoughtContent ?? '') + event.text }
            : msg
        ),
      };

    case 'tool_call_upsert': {
      if (!msgId) return state;
      const chatToolCall = acpToolCallToChat(event.toolCall, agentName);
      return {
        ...state,
        messages: state.messages.map((msg) => {
          if (msg.id !== msgId) return msg;
          const toolCalls = msg.toolCalls ?? [];
          const index = toolCalls.findIndex((tc) => tc.id === chatToolCall.id);
          return {
            ...msg,
            toolCalls:
              index >= 0
                ? toolCalls.map((tc, i) => (i === index ? chatToolCall : tc))
                : [...toolCalls, chatToolCall],
          };
        }),
      };
    }

    case 'plan':
      return { ...state, acpSession: { ...session, plan: event.entries } };

    case 'available_commands':
      return { ...state, acpSession: { ...session, availableCommands: event.commands } };

    case 'mode_changed':
      return {
        ...state,
        acpSession: {
          ...session,
          modes: session.modes ? { ...session.modes, currentModeId: event.currentModeId } : null,
        },
      };

    case 'config_options':
      return { ...state, acpSession: { ...session, configOptions: event.options } };

    case 'usage': {
      const used = typeof event.usage.used === 'number' ? event.usage.used : 0;
      const size = typeof event.usage.size === 'number' ? event.usage.size : 0;
      return { ...state, acpSession: { ...session, usage: { used, size } } };
    }

    case 'permission_resolved':
      if (session.activePermission?.requestId !== event.requestId) return state;
      return { ...state, acpSession: { ...session, activePermission: null } };

    case 'turn_ended':
      return finalizeAcpTurn(
        state,
        event.stopReason === 'end_turn' ? null : `\n\n[stopped: ${event.stopReason}]`,
        'ready'
      );

    case 'turn_error':
      return finalizeAcpTurn(state, `\n\nError: ${event.message}`, 'ready');

    case 'session_dead': {
      const next = finalizeAcpTurn(state, null, 'dead');
      const deadNotice: ChatMessage = {
        id: generateId(),
        role: 'system',
        content: `Agent session ended: ${event.reason}. Your next message will start a new session.`,
        timestamp: new Date().toISOString(),
      };
      return {
        ...next,
        messages: [...next.messages, deadNotice],
        acpSession: next.acpSession ? { ...next.acpSession, activePermission: null } : null,
      };
    }

    default:
      return state;
  }
}

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
        acpSession: null,
        isProcessing: false,
        streamingMessageId: null,
      };

    case 'SET_BACKEND':
      return { ...state, backend: action.backend };

    case 'ACP_SESSION_STARTED':
      return { ...state, acpSession: action.session };

    case 'ACP_SESSION_ENDED':
      return { ...state, acpSession: null };

    case 'ACP_EVENT':
      if (!state.acpSession || state.acpSession.sessionId !== action.sessionId) return state;
      return applyAcpEvent(state, action.event);

    case 'ACP_PERMISSION_REQUEST':
      if (!state.acpSession || state.acpSession.sessionId !== action.payload.sessionId) {
        return state;
      }
      return {
        ...state,
        acpSession: { ...state.acpSession, activePermission: action.payload },
      };

    case 'ACP_PERMISSION_CLEARED':
      if (state.acpSession?.activePermission?.requestId !== action.requestId) return state;
      return {
        ...state,
        acpSession: { ...state.acpSession, activePermission: null },
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
  // ACP
  /** Switch the chat backend; starts a fresh conversation */
  setBackend: (backend: ChatBackend) => void;
  /** Cancel the in-flight ACP agent turn */
  cancelAcpTurn: () => void;
  /** Answer a pending ACP permission request */
  respondAcpPermission: (requestId: string, outcome: AcpPermissionOutcome) => void;
  setAcpMode: (modeId: string) => void;
  setAcpConfigOption: (configId: string, value: string | boolean) => void;
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

  // Track which messages have triggered auto-continuation to prevent duplicates
  const continuationTriggeredRef = useRef<Set<string>>(new Set());

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
  const newSession = useCallback(() => {
    dispatch({ type: 'NEW_SESSION' });
    continuationTriggeredRef.current.clear();
  }, []);

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

  // ============================================
  // ACP send path
  // ============================================

  const sendAcpMessage = useCallback(
    async (content: string) => {
      if (state.backend.kind !== 'acp' || !adapter.acp) return;
      const acp = adapter.acp;
      const { agentId, agentName } = state.backend;

      dispatch({ type: 'ADD_TO_HISTORY', value: content });
      dispatch({ type: 'SET_INPUT', value: '' });
      addMessage({ role: 'user', content });

      try {
        let session = state.acpSession;
        if (!session || session.status === 'dead' || session.agentId !== agentId) {
          // Resolve the session cwd: the agent's remembered default or a picker
          const agents = await acp.getAgents();
          const agent = agents.find((a) => a.id === agentId);
          let cwd = agent?.defaultSessionCwd ?? null;
          if (!cwd) {
            cwd = await acp.pickDirectory();
            if (!cwd) {
              addMessage({
                role: 'system',
                content: 'Agent sessions need a working directory — pick a folder to continue.',
              });
              return;
            }
          }

          addMessage({
            role: 'system',
            content: `Starting ${agentName} in ${cwd}… (the first run may take a minute)`,
          });
          dispatch({ type: 'SET_PROCESSING', isProcessing: true });
          const result = await acp.newSession(agentId, cwd);
          session = {
            sessionId: result.sessionId,
            agentId,
            cwd: result.cwd,
            status: 'ready',
            modes: result.modes,
            configOptions: result.configOptions,
            availableCommands: [],
            plan: null,
            activePermission: null,
            usage: null,
          };
          dispatch({ type: 'ACP_SESSION_STARTED', session });
        }

        const assistantMsg = addMessage({
          role: 'assistant',
          content: '',
          isStreaming: true,
          backend: 'acp',
        });
        dispatch({ type: 'SET_PROCESSING', isProcessing: true });
        dispatch({ type: 'SET_STREAMING_MESSAGE', id: assistantMsg.id });

        // Returns immediately; turn_ended / turn_error events finalize the message
        await acp.prompt(session.sessionId, content);
      } catch (err) {
        console.error('[Chat] ACP error:', err);
        addMessage({
          role: 'system',
          content: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
        });
        dispatch({ type: 'SET_PROCESSING', isProcessing: false });
        dispatch({ type: 'SET_STREAMING_MESSAGE', id: null });
      }
    },
    [state.backend, state.acpSession, adapter, addMessage]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || state.isProcessing) return;

      // ACP agents own their loop — bypass the AI SDK path entirely
      if (state.backend.kind === 'acp') {
        await sendAcpMessage(content.trim());
        return;
      }

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
      continuationTriggeredRef.current.clear(); // Clear continuation tracking for new conversation turn
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
              // Filter content by audience - only include assistant-targeted content
              if (completedCalls.length > 0) {
                const toolResults = completedCalls.map((tc) => ({
                  type: 'tool-result',
                  toolCallId: tc.id,
                  toolName: tc.qualifiedName,
                  result: filterContentForAssistant(tc.result!.content),
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
    [state.isProcessing, state.messages, state.servers, state.tools, state.sessionId, state.backend, addMessage, doer, dreamer, adapter, sendAcpMessage]
  );

  // ============================================
  // ACP actions
  // ============================================

  const setBackend = useCallback((backend: ChatBackend) => {
    dispatch({ type: 'SET_BACKEND', backend });
    dispatch({ type: 'NEW_SESSION' });
    continuationTriggeredRef.current.clear();
  }, []);

  const cancelAcpTurn = useCallback(() => {
    if (state.acpSession && adapter.acp) {
      adapter.acp.cancel(state.acpSession.sessionId).catch((err) => {
        console.error('[Chat] ACP cancel failed:', err);
      });
    }
  }, [state.acpSession, adapter]);

  const respondAcpPermission = useCallback(
    (requestId: string, outcome: AcpPermissionOutcome) => {
      adapter.acp?.respondPermission(requestId, outcome).catch((err) => {
        console.error('[Chat] ACP permission response failed:', err);
      });
      dispatch({ type: 'ACP_PERMISSION_CLEARED', requestId });
    },
    [adapter]
  );

  const setAcpMode = useCallback(
    (modeId: string) => {
      if (state.acpSession && adapter.acp) {
        adapter.acp.setMode(state.acpSession.sessionId, modeId).catch((err) => {
          console.error('[Chat] ACP set mode failed:', err);
        });
      }
    },
    [state.acpSession, adapter]
  );

  const setAcpConfigOption = useCallback(
    (configId: string, value: string | boolean) => {
      if (state.acpSession && adapter.acp) {
        adapter.acp.setConfigOption(state.acpSession.sessionId, configId, value).catch((err) => {
          console.error('[Chat] ACP set config option failed:', err);
        });
      }
    },
    [state.acpSession, adapter]
  );

  // Subscribe to ACP session updates and permission requests (Electron only)
  useEffect(() => {
    if (!adapter.acp) return;
    const unsubUpdate = adapter.acp.onSessionUpdate(({ sessionId, event }) => {
      dispatch({ type: 'ACP_EVENT', sessionId, event });
    });
    const unsubPermission = adapter.acp.onPermissionRequest((payload) => {
      dispatch({ type: 'ACP_PERMISSION_REQUEST', payload });
    });
    return () => {
      unsubUpdate();
      unsubPermission();
    };
  }, [adapter]);

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
              // Filter content by audience - only include assistant-targeted content
              if (completedCalls.length > 0) {
                const toolResults = completedCalls.map((tc) => ({
                  type: 'tool-result',
                  toolCallId: tc.id,
                  toolName: tc.qualifiedName,
                  result: filterContentForAssistant(tc.result!.content),
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
    // ACP agents run their own loop — never auto-continue
    if (state.backend.kind === 'acp') return;

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

    // Create a unique key for this continuation attempt (message ID + tool call count + turn)
    const continuationKey = `${lastAssistantMsg.id}-${lastAssistantMsg.toolCalls.length}-${state.currentTurn}`;

    // Skip if we've already triggered continuation for this state
    if (continuationTriggeredRef.current.has(continuationKey)) {
      return;
    }

    // Mark as triggered before calling to prevent duplicates
    continuationTriggeredRef.current.add(continuationKey);

    console.log(`[Chat] Auto-continue: Triggering continuation (turn ${state.currentTurn + 1}/${modelConfig.maxTurns})`);
    continueAfterTools(lastAssistantMsg.id);
  }, [state.messages, state.isProcessing, state.currentTurn, state.backend.kind, continueAfterTools]);

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
    setBackend,
    cancelAcpTurn,
    respondAcpPermission,
    setAcpMode,
    setAcpConfigOption,
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
