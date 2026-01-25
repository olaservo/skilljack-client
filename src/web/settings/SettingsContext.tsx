/**
 * Settings Context
 *
 * Manages model and tool settings state and persistence.
 * Provides Doer vs Dreamer model configuration.
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
  ModelSettings,
  ModelConfig,
  ToolSettings,
  SettingsState,
  SettingsAction,
} from './types.js';
import { defaultModelSettings, defaultToolSettings } from './types.js';

// ============================================
// Local Storage
// ============================================

const MODEL_STORAGE_KEY = 'skilljack-model-settings';
const TOOL_STORAGE_KEY = 'skilljack-tool-settings';

function loadModelSettings(): ModelSettings {
  try {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Validate structure
      if (parsed.doer && parsed.dreamer) {
        return {
          doer: {
            provider: parsed.doer.provider || defaultModelSettings.doer.provider,
            modelId: parsed.doer.modelId || defaultModelSettings.doer.modelId,
            temperature: parsed.doer.temperature ?? defaultModelSettings.doer.temperature,
            maxTurns: parsed.doer.maxTurns ?? defaultModelSettings.doer.maxTurns,
          },
          dreamer: {
            provider: parsed.dreamer.provider || defaultModelSettings.dreamer.provider,
            modelId: parsed.dreamer.modelId || defaultModelSettings.dreamer.modelId,
            temperature: parsed.dreamer.temperature ?? defaultModelSettings.dreamer.temperature,
            maxTurns: parsed.dreamer.maxTurns ?? defaultModelSettings.dreamer.maxTurns,
          },
        };
      }
    }
  } catch {
    // Ignore parse errors
  }
  return defaultModelSettings;
}

function loadToolSettings(): ToolSettings {
  try {
    const saved = localStorage.getItem(TOOL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        confirmDangerousTools: parsed.confirmDangerousTools ?? defaultToolSettings.confirmDangerousTools,
      };
    }
  } catch {
    // Ignore parse errors
  }
  return defaultToolSettings;
}

// ============================================
// Reducer
// ============================================

const initialState: SettingsState = {
  models: loadModelSettings(),
  tools: loadToolSettings(),
};

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'SET_DOER':
      return {
        ...state,
        models: { ...state.models, doer: action.config },
      };

    case 'SET_DREAMER':
      return {
        ...state,
        models: { ...state.models, dreamer: action.config },
      };

    case 'SET_CONFIRM_DANGEROUS_TOOLS':
      return {
        ...state,
        tools: { ...state.tools, confirmDangerousTools: action.enabled },
      };

    case 'RESET_DEFAULTS':
      return {
        ...state,
        models: defaultModelSettings,
        tools: defaultToolSettings,
      };

    default:
      return state;
  }
}

// ============================================
// Context
// ============================================

interface SettingsContextValue {
  state: SettingsState;
  dispatch: Dispatch<SettingsAction>;
  // Convenience actions
  setDoer: (config: ModelConfig) => void;
  setDreamer: (config: ModelConfig) => void;
  setConfirmDangerousTools: (enabled: boolean) => void;
  resetDefaults: () => void;
  // Computed
  doer: ModelConfig;
  dreamer: ModelConfig;
  confirmDangerousTools: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

// ============================================
// Provider
// ============================================

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [state, dispatch] = useReducer(settingsReducer, initialState);

  // Convenience actions
  const setDoer = useCallback((config: ModelConfig) => {
    dispatch({ type: 'SET_DOER', config });
  }, []);

  const setDreamer = useCallback((config: ModelConfig) => {
    dispatch({ type: 'SET_DREAMER', config });
  }, []);

  const setConfirmDangerousTools = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_CONFIRM_DANGEROUS_TOOLS', enabled });
  }, []);

  const resetDefaults = useCallback(() => {
    dispatch({ type: 'RESET_DEFAULTS' });
  }, []);

  // Persist model settings on change
  useEffect(() => {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(state.models));
  }, [state.models]);

  // Persist tool settings on change
  useEffect(() => {
    localStorage.setItem(TOOL_STORAGE_KEY, JSON.stringify(state.tools));
  }, [state.tools]);

  const value: SettingsContextValue = {
    state,
    dispatch,
    setDoer,
    setDreamer,
    setConfirmDangerousTools,
    resetDefaults,
    doer: state.models.doer,
    dreamer: state.models.dreamer,
    confirmDangerousTools: state.tools.confirmDangerousTools,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

// ============================================
// Hook
// ============================================

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
