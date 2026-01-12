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

const modernDarkTheme: Theme = {
  id: 'modern-dark',
  name: 'Modern Dark',
  author: 'Skilljack',
  version: '1.0.0',
  variables: {
    '--bg-primary': '#0f0f0f',
    '--bg-secondary': '#1a1a1a',
    '--bg-panel': '#242424',
    '--bg-hover': '#2a2a2a',
    '--bg-active': '#333333',
    '--text-primary': '#e4e4e4',
    '--text-secondary': '#a0a0a0',
    '--text-muted': '#666666',
    '--accent': '#6366f1',
    '--accent-hover': '#818cf8',
    '--accent-muted': '#4f46e5',
    '--success': '#22c55e',
    '--error': '#ef4444',
    '--warning': '#f59e0b',
    '--info': '#3b82f6',
    '--border': '#333333',
    '--border-hover': '#444444',
    '--font-family': "'SF Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
    '--font-mono': "'SF Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
    '--font-size-base': '1rem',
    '--radius-sm': '4px',
    '--radius-md': '8px',
    '--radius-lg': '12px',
    '--radius-full': '9999px',
    '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)',
    '--shadow-md': '0 4px 6px rgba(0, 0, 0, 0.4)',
    '--shadow-lg': '0 10px 15px rgba(0, 0, 0, 0.5)',
    '--shadow-drawer': '0 -4px 20px rgba(0, 0, 0, 0.5)',
    '--bezel-light': 'transparent',
    '--bezel-dark': 'transparent',
    '--glow': 'none',
    '--scanlines': 'none',
  },
};

const modernLightTheme: Theme = {
  id: 'modern-light',
  name: 'Modern Light',
  author: 'Skilljack',
  version: '1.0.0',
  variables: {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f5f5f5',
    '--bg-panel': '#fafafa',
    '--bg-hover': '#f0f0f0',
    '--bg-active': '#e5e5e5',
    '--text-primary': '#171717',
    '--text-secondary': '#525252',
    '--text-muted': '#a3a3a3',
    '--accent': '#6366f1',
    '--accent-hover': '#4f46e5',
    '--accent-muted': '#818cf8',
    '--success': '#16a34a',
    '--error': '#dc2626',
    '--warning': '#d97706',
    '--info': '#2563eb',
    '--border': '#e5e5e5',
    '--border-hover': '#d4d4d4',
    '--font-family': "'SF Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
    '--font-mono': "'SF Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
    '--font-size-base': '1rem',
    '--radius-sm': '4px',
    '--radius-md': '8px',
    '--radius-lg': '12px',
    '--radius-full': '9999px',
    '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.05)',
    '--shadow-md': '0 4px 6px rgba(0, 0, 0, 0.1)',
    '--shadow-lg': '0 10px 15px rgba(0, 0, 0, 0.15)',
    '--shadow-drawer': '0 -4px 20px rgba(0, 0, 0, 0.1)',
    '--bezel-light': 'transparent',
    '--bezel-dark': 'transparent',
    '--glow': 'none',
    '--scanlines': 'none',
  },
};

const winampClassicTheme: Theme = {
  id: 'winamp-classic',
  name: 'Winamp Classic',
  author: 'Skilljack',
  version: '1.0.0',
  variables: {
    '--bg-primary': '#232323',
    '--bg-secondary': '#2e2e2e',
    '--bg-panel': '#3c3c3c',
    '--bg-hover': '#4a4a4a',
    '--bg-active': '#555555',
    '--text-primary': '#00ff00',
    '--text-secondary': '#00cc00',
    '--text-muted': '#008800',
    '--accent': '#ff6600',
    '--accent-hover': '#ff8833',
    '--accent-muted': '#cc5500',
    '--success': '#00ff00',
    '--error': '#ff0000',
    '--warning': '#ffff00',
    '--info': '#00ffff',
    '--border': '#1a1a1a',
    '--border-hover': '#4a4a4a',
    '--font-family': "'Arial', 'Helvetica', sans-serif",
    '--font-mono': "'Courier New', 'Courier', monospace",
    '--font-size-base': '0.875rem',
    '--radius-sm': '0px',
    '--radius-md': '0px',
    '--radius-lg': '0px',
    '--radius-full': '0px',
    '--shadow-sm': 'inset 1px 1px 0 var(--bezel-light), inset -1px -1px 0 var(--bezel-dark)',
    '--shadow-md': 'inset 2px 2px 0 var(--bezel-light), inset -2px -2px 0 var(--bezel-dark)',
    '--shadow-lg': 'inset 3px 3px 0 var(--bezel-light), inset -3px -3px 0 var(--bezel-dark)',
    '--shadow-drawer': 'inset 0 3px 0 var(--bezel-light)',
    '--bezel-light': '#5a5a5a',
    '--bezel-dark': '#1a1a1a',
    '--glow': '0 0 8px #00ff00',
    '--scanlines': 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.1) 1px, rgba(0,0,0,0.1) 2px)',
  },
  customCss: `
    /* Winamp-style LED display effect */
    .chat-message[data-role='assistant'] .chat-message-bubble {
      text-shadow: var(--glow);
      background: linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%);
    }

    /* Beveled buttons */
    .chat-send-button {
      border: 2px outset #666;
      border-radius: 0;
    }

    .chat-send-button:active {
      border-style: inset;
    }

    /* Scanline effect on drawer */
    .chat-drawer::after {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--scanlines);
      pointer-events: none;
      opacity: 0.3;
    }
  `,
};

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

const vaporwaveTheme: Theme = {
  id: 'vaporwave',
  name: 'Vaporwave',
  author: 'Skilljack',
  version: '1.0.0',
  variables: {
    '--bg-primary': '#1a0a2e',
    '--bg-secondary': '#2d1b4e',
    '--bg-panel': '#3d2a5e',
    '--bg-hover': '#4d3a6e',
    '--bg-active': '#5d4a7e',
    '--text-primary': '#ff71ce',
    '--text-secondary': '#b967ff',
    '--text-muted': '#8b5fbf',
    '--accent': '#01cdfe',
    '--accent-hover': '#33d9ff',
    '--accent-muted': '#0099cc',
    '--success': '#05ffa1',
    '--error': '#ff3366',
    '--warning': '#fffb96',
    '--info': '#01cdfe',
    '--border': '#4d3a6e',
    '--border-hover': '#6d5a8e',
    '--font-family': "'Arial', 'Helvetica', sans-serif",
    '--font-mono': "'VT323', 'Courier New', monospace",
    '--font-size-base': '1rem',
    '--radius-sm': '4px',
    '--radius-md': '8px',
    '--radius-lg': '16px',
    '--radius-full': '9999px',
    '--shadow-sm': '0 0 10px rgba(1, 205, 254, 0.3)',
    '--shadow-md': '0 0 20px rgba(255, 113, 206, 0.4)',
    '--shadow-lg': '0 0 30px rgba(185, 103, 255, 0.5)',
    '--shadow-drawer': '0 -4px 30px rgba(255, 113, 206, 0.4), 0 -8px 60px rgba(1, 205, 254, 0.2)',
    '--bezel-light': 'transparent',
    '--bezel-dark': 'transparent',
    '--glow': '0 0 10px currentColor',
    '--scanlines': 'none',
  },
  customCss: `
    /* Gradient background */
    .chat-drawer {
      background: linear-gradient(135deg, var(--bg-panel) 0%, #2d1b4e 50%, #1a0a2e 100%);
    }

    /* Neon glow on text */
    .chat-message[data-role='user'] .chat-message-bubble {
      background: linear-gradient(135deg, #01cdfe 0%, #b967ff 100%);
      box-shadow: 0 0 15px rgba(1, 205, 254, 0.5);
    }

    .chat-message[data-role='assistant'] .chat-message-bubble {
      border: 1px solid #ff71ce;
      box-shadow: 0 0 10px rgba(255, 113, 206, 0.3);
    }

    /* Accent glow */
    .chat-send-button {
      box-shadow: 0 0 15px rgba(1, 205, 254, 0.5);
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
  modernDarkTheme,
  modernLightTheme,
  winampClassicTheme,
  terminalGreenTheme,
  vaporwaveTheme,
  pixelPerfectTheme,
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
  return modernDarkTheme;
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
