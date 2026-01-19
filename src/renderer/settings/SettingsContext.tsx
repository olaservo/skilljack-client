/**
 * Settings Context
 *
 * Manages model settings state and persistence.
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
  SettingsState,
  SettingsAction,
} from './types.js';
import { defaultModelSettings } from './types.js';

// ============================================
// Local Storage
// ============================================

const STORAGE_KEY = 'skilljack-model-settings';

function loadSettings(): ModelSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
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

// ============================================
// Reducer
// ============================================

const initialState: SettingsState = {
  models: loadSettings(),
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

    case 'RESET_DEFAULTS':
      return {
        ...state,
        models: defaultModelSettings,
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
  resetDefaults: () => void;
  // Computed
  doer: ModelConfig;
  dreamer: ModelConfig;
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

  const resetDefaults = useCallback(() => {
    dispatch({ type: 'RESET_DEFAULTS' });
  }, []);

  // Persist settings on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.models));
  }, [state.models]);

  const value: SettingsContextValue = {
    state,
    dispatch,
    setDoer,
    setDreamer,
    resetDefaults,
    doer: state.models.doer,
    dreamer: state.models.dreamer,
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
