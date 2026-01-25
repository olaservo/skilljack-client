/**
 * MCP App Context
 *
 * Manages MCP App panels state for Electron renderer.
 * Exposes window.loadMcpApp for useToolExecution to call.
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useReducer,
  useMemo,
} from 'react';
import { getCommunicationAdapter } from '../hooks/useCommunication';
import type { UIResource } from '../../shared/types';

// Extend Window interface for loadMcpApp
declare global {
  interface Window {
    loadMcpApp?: (
      serverName: string,
      uiResourceUri: string,
      toolInput: Record<string, unknown>,
      toolResult: unknown
    ) => Promise<void>;
    clearMcpApp?: () => void;
  }
}

/**
 * Panel data structure
 */
export interface McpAppPanel {
  key: string;
  serverName: string;
  uiResourceUri: string;
  toolInput: Record<string, unknown>;
  toolResult: unknown;
  uiResource: UIResource | null;
  loading: boolean;
  error: string | null;
}

/**
 * Context state
 */
interface McpAppState {
  panels: Map<string, McpAppPanel>;
  layoutMode: 'grid' | 'tabs' | 'stack';
  activeTabKey: string | null;
}

/**
 * Context value
 */
interface McpAppContextValue {
  panels: McpAppPanel[];
  layoutMode: 'grid' | 'tabs' | 'stack';
  activeTabKey: string | null;
  openPanel: (
    serverName: string,
    uiResourceUri: string,
    toolInput: Record<string, unknown>,
    toolResult: unknown
  ) => Promise<void>;
  closePanel: (key: string) => void;
  updatePanel: (
    key: string,
    toolInput: Record<string, unknown>,
    toolResult: unknown
  ) => void;
  setLayoutMode: (mode: 'grid' | 'tabs' | 'stack') => void;
  setActiveTab: (key: string) => void;
}

// Actions
type McpAppAction =
  | { type: 'OPEN_PANEL'; panel: McpAppPanel }
  | { type: 'UPDATE_PANEL'; key: string; uiResource: UIResource; loading: false }
  | { type: 'UPDATE_PANEL_ERROR'; key: string; error: string }
  | { type: 'UPDATE_PANEL_DATA'; key: string; toolInput: Record<string, unknown>; toolResult: unknown }
  | { type: 'CLOSE_PANEL'; key: string }
  | { type: 'SET_LAYOUT_MODE'; mode: 'grid' | 'tabs' | 'stack' }
  | { type: 'SET_ACTIVE_TAB'; key: string };

function reducer(state: McpAppState, action: McpAppAction): McpAppState {
  switch (action.type) {
    case 'OPEN_PANEL': {
      const newPanels = new Map(state.panels);
      newPanels.set(action.panel.key, action.panel);
      return {
        ...state,
        panels: newPanels,
        activeTabKey: state.layoutMode === 'tabs' ? action.panel.key : state.activeTabKey,
      };
    }

    case 'UPDATE_PANEL': {
      const panel = state.panels.get(action.key);
      if (!panel) return state;
      const newPanels = new Map(state.panels);
      newPanels.set(action.key, {
        ...panel,
        uiResource: action.uiResource,
        loading: false,
        error: null,
      });
      return { ...state, panels: newPanels };
    }

    case 'UPDATE_PANEL_ERROR': {
      const panel = state.panels.get(action.key);
      if (!panel) return state;
      const newPanels = new Map(state.panels);
      newPanels.set(action.key, {
        ...panel,
        loading: false,
        error: action.error,
      });
      return { ...state, panels: newPanels };
    }

    case 'UPDATE_PANEL_DATA': {
      const panel = state.panels.get(action.key);
      if (!panel) return state;
      const newPanels = new Map(state.panels);
      newPanels.set(action.key, {
        ...panel,
        toolInput: action.toolInput,
        toolResult: action.toolResult,
      });
      return { ...state, panels: newPanels };
    }

    case 'CLOSE_PANEL': {
      const newPanels = new Map(state.panels);
      newPanels.delete(action.key);

      // If closing active tab, switch to another
      let newActiveTab = state.activeTabKey;
      if (state.activeTabKey === action.key) {
        const keys = Array.from(newPanels.keys());
        newActiveTab = keys.length > 0 ? keys[0] : null;
      }

      return {
        ...state,
        panels: newPanels,
        activeTabKey: newActiveTab,
      };
    }

    case 'SET_LAYOUT_MODE': {
      // When switching to tabs mode, ensure activeTabKey is set
      let newActiveTabKey = state.activeTabKey;
      if (action.mode === 'tabs' && !state.activeTabKey && state.panels.size > 0) {
        newActiveTabKey = Array.from(state.panels.keys())[0];
      }
      return { ...state, layoutMode: action.mode, activeTabKey: newActiveTabKey };
    }

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTabKey: action.key };

    default:
      return state;
  }
}

const initialState: McpAppState = {
  panels: new Map(),
  layoutMode: 'grid',
  activeTabKey: null,
};

const McpAppContext = createContext<McpAppContextValue | null>(null);

export function McpAppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const adapter = getCommunicationAdapter();

  /**
   * Generate panel key from serverName and uiResourceUri
   */
  const generateKey = useCallback(
    (serverName: string, uiResourceUri: string) => `${serverName}__${uiResourceUri}`,
    []
  );

  /**
   * Open a new panel or update existing one
   */
  const openPanel = useCallback(
    async (
      serverName: string,
      uiResourceUri: string,
      toolInput: Record<string, unknown>,
      toolResult: unknown
    ) => {
      const key = generateKey(serverName, uiResourceUri);
      const existingPanel = state.panels.get(key);

      if (existingPanel) {
        // Update existing panel with new data
        dispatch({ type: 'UPDATE_PANEL_DATA', key, toolInput, toolResult });

        // If in tabs mode, switch to this panel
        if (state.layoutMode === 'tabs') {
          dispatch({ type: 'SET_ACTIVE_TAB', key });
        }
        return;
      }

      // Create new panel (loading state)
      const newPanel: McpAppPanel = {
        key,
        serverName,
        uiResourceUri,
        toolInput,
        toolResult,
        uiResource: null,
        loading: true,
        error: null,
      };
      dispatch({ type: 'OPEN_PANEL', panel: newPanel });

      // Fetch UI resource
      try {
        const uiResource = await adapter.getUIResource(serverName, uiResourceUri);
        if (!uiResource) {
          throw new Error('UI resource not found');
        }
        dispatch({ type: 'UPDATE_PANEL', key, uiResource, loading: false });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load UI resource';
        console.error('[McpAppContext] Failed to fetch UI resource:', err);
        dispatch({ type: 'UPDATE_PANEL_ERROR', key, error: errorMessage });
      }
    },
    [state.panels, state.layoutMode, generateKey, adapter]
  );

  /**
   * Close a panel
   */
  const closePanel = useCallback((key: string) => {
    dispatch({ type: 'CLOSE_PANEL', key });
  }, []);

  /**
   * Update panel data (for when same tool is called again)
   */
  const updatePanel = useCallback(
    (key: string, toolInput: Record<string, unknown>, toolResult: unknown) => {
      dispatch({ type: 'UPDATE_PANEL_DATA', key, toolInput, toolResult });
    },
    []
  );

  /**
   * Set layout mode
   */
  const setLayoutMode = useCallback((mode: 'grid' | 'tabs' | 'stack') => {
    dispatch({ type: 'SET_LAYOUT_MODE', mode });
  }, []);

  /**
   * Set active tab (for tabs mode)
   */
  const setActiveTab = useCallback((key: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', key });
  }, []);

  /**
   * Register global window.loadMcpApp function
   */
  useEffect(() => {
    window.loadMcpApp = async (
      serverName: string,
      uiResourceUri: string,
      toolInput: Record<string, unknown>,
      toolResult: unknown
    ) => {
      await openPanel(serverName, uiResourceUri, toolInput, toolResult);
    };

    window.clearMcpApp = () => {
      for (const key of state.panels.keys()) {
        dispatch({ type: 'CLOSE_PANEL', key });
      }
    };

    return () => {
      delete window.loadMcpApp;
      delete window.clearMcpApp;
    };
  }, [openPanel, state.panels]);

  // Convert Map to array for easier rendering
  const panelsArray = useMemo(() => Array.from(state.panels.values()), [state.panels]);

  const value: McpAppContextValue = useMemo(
    () => ({
      panels: panelsArray,
      layoutMode: state.layoutMode,
      activeTabKey: state.activeTabKey,
      openPanel,
      closePanel,
      updatePanel,
      setLayoutMode,
      setActiveTab,
    }),
    [
      panelsArray,
      state.layoutMode,
      state.activeTabKey,
      openPanel,
      closePanel,
      updatePanel,
      setLayoutMode,
      setActiveTab,
    ]
  );

  return (
    <McpAppContext.Provider value={value}>{children}</McpAppContext.Provider>
  );
}

/**
 * Hook to access MCP App context
 */
export function useMcpApps(): McpAppContextValue {
  const context = useContext(McpAppContext);
  if (!context) {
    throw new Error('useMcpApps must be used within McpAppProvider');
  }
  return context;
}
