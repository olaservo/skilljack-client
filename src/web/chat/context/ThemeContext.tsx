/**
 * Theme Context
 *
 * Manages theme state and CSS variable application.
 * Supports live preview, custom themes, and persistence.
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
import type { Theme, ThemeState, ThemeAction, ThemeVariables } from '../types';

// ============================================
// Built-in Themes
// ============================================

const terminalGreenTheme: Theme = {
  id: 'terminal-green',
  name: 'Terminal Green',
  author: 'Skilljack',
  version: '1.0.0',
  variables: {
    '--bg-primary': '#0a0a0a',
    '--bg-secondary': '#0d0d0d',
    '--bg-panel': '#111111',
    '--bg-hover': '#1a1a1a',
    '--bg-active': '#222222',
    '--text-primary': '#00ff41',
    '--text-secondary': '#00cc33',
    '--text-muted': '#006622',
    '--accent': '#00ff41',
    '--accent-hover': '#33ff66',
    '--accent-muted': '#00cc33',
    '--success': '#00ff41',
    '--error': '#ff3333',
    '--warning': '#ffff00',
    '--info': '#00ffff',
    '--border': '#003311',
    '--border-hover': '#004422',
    '--font-family': "'Courier New', 'Courier', monospace",
    '--font-mono': "'Courier New', 'Courier', monospace",
    '--font-size-base': '0.9375rem',
    '--radius-sm': '0px',
    '--radius-md': '0px',
    '--radius-lg': '0px',
    '--radius-full': '0px',
    '--shadow-sm': 'none',
    '--shadow-md': 'none',
    '--shadow-lg': 'none',
    '--shadow-drawer': '0 0 30px rgba(0, 255, 65, 0.2)',
    '--bezel-light': 'transparent',
    '--bezel-dark': 'transparent',
    '--glow': '0 0 10px #00ff41, 0 0 20px #00ff41',
    '--scanlines': 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.03) 2px, rgba(0,255,65,0.03) 4px)',
  },
  customCss: `
    /* CRT glow effect */
    .chat-drawer {
      box-shadow: var(--shadow-drawer), inset 0 0 100px rgba(0, 255, 65, 0.05);
    }

    .chat-message-bubble {
      text-shadow: var(--glow);
    }

    /* Blinking cursor */
    .chat-input::placeholder {
      animation: terminal-blink 1s step-end infinite;
    }

    @keyframes terminal-blink {
      0%, 50% { opacity: 1; }
      51%, 100% { opacity: 0; }
    }

    /* Scanlines */
    .chat-output::before {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--scanlines);
      pointer-events: none;
    }
  `,
};

const pixelPerfectTheme: Theme = {
  id: 'pixel-perfect',
  name: 'Pixel Perfect',
  author: 'Skilljack',
  version: '1.0.0',
  variables: {
    '--bg-primary': '#1f1f1f',
    '--bg-secondary': '#2d2d2d',
    '--bg-panel': '#3a3a3a',
    '--bg-hover': '#474747',
    '--bg-active': '#545454',
    '--text-primary': '#ffffff',
    '--text-secondary': '#cccccc',
    '--text-muted': '#888888',
    '--accent': '#4a90d9',
    '--accent-hover': '#5da0e9',
    '--accent-muted': '#3a80c9',
    '--success': '#6abd6a',
    '--error': '#d94a4a',
    '--warning': '#d9a54a',
    '--info': '#4a90d9',
    '--border': '#555555',
    '--border-hover': '#666666',
    '--font-family': "'Press Start 2P', 'Courier New', monospace",
    '--font-mono': "'Press Start 2P', 'Courier New', monospace",
    '--font-size-base': '0.75rem',
    '--radius-sm': '0px',
    '--radius-md': '0px',
    '--radius-lg': '0px',
    '--radius-full': '0px',
    '--shadow-sm': '2px 2px 0 #000',
    '--shadow-md': '3px 3px 0 #000',
    '--shadow-lg': '4px 4px 0 #000',
    '--shadow-drawer': '0 -4px 0 #000',
    '--bezel-light': '#666666',
    '--bezel-dark': '#222222',
    '--glow': 'none',
    '--scanlines': 'none',
  },
  customCss: `
    /* Pixelated borders */
    .chat-drawer {
      border-top: 4px solid #555;
      border-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGklEQVQYV2NkYGD4z8DAwMgABYxgAgQAADABBgBPMQT/AAAAAElFTkSuQmCC") 2 repeat;
    }

    /* Chunky buttons */
    .chat-send-button {
      border: 4px solid;
      border-color: var(--bezel-light) var(--bezel-dark) var(--bezel-dark) var(--bezel-light);
    }

    .chat-send-button:active {
      border-color: var(--bezel-dark) var(--bezel-light) var(--bezel-light) var(--bezel-dark);
    }

    /* Blocky input */
    .chat-input {
      border: 4px solid;
      border-color: var(--bezel-dark) var(--bezel-light) var(--bezel-light) var(--bezel-dark);
    }
  `,
};

const builtInThemes: Theme[] = [
  pixelPerfectTheme,
  terminalGreenTheme,
];

// ============================================
// Initial State
// ============================================

function loadSavedTheme(): Theme {
  try {
    const saved = localStorage.getItem('skilljack-theme');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Try to find built-in theme by ID
      const builtIn = builtInThemes.find((t) => t.id === parsed.id);
      if (builtIn) return builtIn;
      // Otherwise use saved custom theme
      return parsed;
    }
  } catch {
    // Ignore parse errors
  }
  return pixelPerfectTheme;
}

function loadCustomThemes(): Theme[] {
  try {
    const saved = localStorage.getItem('skilljack-custom-themes');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

const initialState: ThemeState = {
  activeTheme: loadSavedTheme(),
  previewTheme: null,
  isEditing: false,
  availableThemes: builtInThemes,
  customThemes: loadCustomThemes(),
};

// ============================================
// Reducer
// ============================================

function themeReducer(state: ThemeState, action: ThemeAction): ThemeState {
  switch (action.type) {
    case 'SET_THEME':
      return { ...state, activeTheme: action.theme, previewTheme: null };

    case 'PREVIEW_THEME':
      return { ...state, previewTheme: action.theme };

    case 'APPLY_PREVIEW':
      if (!state.previewTheme) return state;
      return { ...state, activeTheme: state.previewTheme, previewTheme: null };

    case 'CANCEL_PREVIEW':
      return { ...state, previewTheme: null };

    case 'SET_EDITING':
      return { ...state, isEditing: action.isEditing };

    case 'ADD_CUSTOM_THEME':
      return {
        ...state,
        customThemes: [...state.customThemes, action.theme],
      };

    case 'REMOVE_CUSTOM_THEME':
      return {
        ...state,
        customThemes: state.customThemes.filter((t) => t.id !== action.id),
      };

    case 'UPDATE_VARIABLE': {
      const currentTheme = state.previewTheme || state.activeTheme;
      const updatedTheme: Theme = {
        ...currentTheme,
        variables: {
          ...currentTheme.variables,
          [action.key]: action.value,
        },
      };
      return { ...state, previewTheme: updatedTheme };
    }

    default:
      return state;
  }
}

// ============================================
// Theme Application
// ============================================

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  // Apply CSS variables
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(key, value);
  }

  // Apply custom CSS
  let styleEl = document.getElementById('theme-custom-css') as HTMLStyleElement;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'theme-custom-css';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = theme.customCss || '';

  // Notify MCP App iframes of theme change
  const iframes = document.querySelectorAll('iframe');
  iframes.forEach((iframe) => {
    try {
      iframe.contentWindow?.postMessage(
        {
          type: 'mcp-theme-update',
          theme: {
            variables: theme.variables,
            isDark: isDarkTheme(theme),
          },
        },
        '*'
      );
    } catch {
      // Cross-origin iframe, skip
    }
  });
}

function isDarkTheme(theme: Theme): boolean {
  // Simple heuristic: check if background is dark
  const bgPrimary = theme.variables['--bg-primary'];
  if (!bgPrimary) return true;
  // Parse hex color and check luminance
  const hex = bgPrimary.replace('#', '');
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }
  return true;
}

// ============================================
// Context
// ============================================

interface ThemeContextValue {
  state: ThemeState;
  dispatch: Dispatch<ThemeAction>;
  // Convenience actions
  setTheme: (theme: Theme) => void;
  setThemeById: (id: string) => void;
  previewTheme: (theme: Theme | null) => void;
  applyPreview: () => void;
  cancelPreview: () => void;
  updateVariable: (key: keyof ThemeVariables, value: string) => void;
  addCustomTheme: (theme: Theme) => void;
  removeCustomTheme: (id: string) => void;
  // Computed
  currentTheme: Theme;
  allThemes: Theme[];
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ============================================
// Provider
// ============================================

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [state, dispatch] = useReducer(themeReducer, initialState);

  // Convenience actions
  const setTheme = useCallback((theme: Theme) => {
    dispatch({ type: 'SET_THEME', theme });
  }, []);

  const setThemeById = useCallback(
    (id: string) => {
      const theme =
        state.availableThemes.find((t) => t.id === id) ||
        state.customThemes.find((t) => t.id === id);
      if (theme) {
        dispatch({ type: 'SET_THEME', theme });
      }
    },
    [state.availableThemes, state.customThemes]
  );

  const previewThemeAction = useCallback((theme: Theme | null) => {
    dispatch({ type: 'PREVIEW_THEME', theme });
  }, []);

  const applyPreview = useCallback(() => {
    dispatch({ type: 'APPLY_PREVIEW' });
  }, []);

  const cancelPreview = useCallback(() => {
    dispatch({ type: 'CANCEL_PREVIEW' });
  }, []);

  const updateVariable = useCallback((key: keyof ThemeVariables, value: string) => {
    dispatch({ type: 'UPDATE_VARIABLE', key, value });
  }, []);

  const addCustomTheme = useCallback((theme: Theme) => {
    dispatch({ type: 'ADD_CUSTOM_THEME', theme });
  }, []);

  const removeCustomTheme = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_CUSTOM_THEME', id });
  }, []);

  // Computed values
  const currentTheme = state.previewTheme || state.activeTheme;
  const allThemes = [...state.availableThemes, ...state.customThemes];
  const isDark = isDarkTheme(currentTheme);

  // Apply theme on change
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  // Persist active theme
  useEffect(() => {
    localStorage.setItem('skilljack-theme', JSON.stringify(state.activeTheme));
  }, [state.activeTheme]);

  // Persist custom themes
  useEffect(() => {
    localStorage.setItem('skilljack-custom-themes', JSON.stringify(state.customThemes));
  }, [state.customThemes]);

  // Listen for theme requests from MCP App iframes
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'mcp-theme-request') {
        event.source?.postMessage(
          {
            type: 'mcp-theme-update',
            theme: {
              variables: currentTheme.variables,
              isDark,
            },
          },
          { targetOrigin: '*' }
        );
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [currentTheme, isDark]);

  const value: ThemeContextValue = {
    state,
    dispatch,
    setTheme,
    setThemeById,
    previewTheme: previewThemeAction,
    applyPreview,
    cancelPreview,
    updateVariable,
    addCustomTheme,
    removeCustomTheme,
    currentTheme,
    allThemes,
    isDark,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ============================================
// Hook
// ============================================

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
