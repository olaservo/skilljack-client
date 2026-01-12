/**
 * Shared Theme Definitions
 *
 * Single source of truth for theme metadata.
 * Used by both server (LLM tool results) and client (ThemeContext).
 */

export interface ThemeMeta {
  id: string;
  name: string;
  author?: string;
}

/**
 * Built-in theme metadata.
 * Order matters - first theme is the default.
 */
export const THEME_LIST: ThemeMeta[] = [
  { id: 'modern-dark', name: 'Modern Dark', author: 'Skilljack' },
  { id: 'modern-light', name: 'Modern Light', author: 'Skilljack' },
  { id: 'winamp-classic', name: 'Winamp Classic', author: 'Skilljack' },
  { id: 'terminal-green', name: 'Terminal Green', author: 'Skilljack' },
  { id: 'vaporwave', name: 'Vaporwave', author: 'Skilljack' },
  { id: 'pixel-perfect', name: 'Pixel Perfect', author: 'Skilljack' },
];

/**
 * Theme tool names handled client-side.
 * These tools modify UI state directly.
 */
export const THEME_TOOL_NAMES = [
  'list_themes',
  'get_current_theme',
  'set_theme',
  'preview_theme',
  'apply_preview',
  'cancel_preview',
  'tweak_theme',
  'generate_theme',
  'save_custom_theme',
] as const;

export type ThemeToolName = typeof THEME_TOOL_NAMES[number];

/**
 * Check if a tool name is a theme tool.
 */
export function isThemeTool(toolName: string): boolean {
  return THEME_TOOL_NAMES.includes(toolName as ThemeToolName);
}

/**
 * Get theme by ID from the list.
 */
export function getThemeMeta(themeId: string): ThemeMeta | undefined {
  return THEME_LIST.find(t => t.id === themeId);
}

/**
 * Format theme list for display.
 */
export function formatThemeList(): string {
  return THEME_LIST.map(t => `${t.name} (${t.id})`).join(', ');
}
