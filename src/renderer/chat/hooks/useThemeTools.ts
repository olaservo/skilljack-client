/**
 * Theme Tools Hook
 *
 * Handles theme tool calls from the LLM.
 * Integrates with ThemeContext to apply theme changes.
 */

import { useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { isThemeTool as checkIsThemeTool } from '../../shared/themes';
import type { ChatToolCall, Theme, ThemeVariables } from '../types';

export interface ThemeToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// Re-export from shared module
export const isThemeTool = checkIsThemeTool;

export function useThemeTools() {
  const {
    state,
    currentTheme,
    allThemes,
    setThemeById,
    previewTheme,
    applyPreview,
    cancelPreview,
    updateVariable,
    addCustomTheme,
  } = useTheme();

  const executeThemeTool = useCallback(
    async (toolCall: ChatToolCall): Promise<ThemeToolResult> => {
      const { name, arguments: args } = toolCall;

      switch (name) {
        case 'list_themes': {
          const themes = allThemes.map((t) => ({
            id: t.id,
            name: t.name,
            author: t.author,
          }));
          return {
            success: true,
            message: `Available themes: ${themes.map((t) => t.name).join(', ')}`,
            data: themes,
          };
        }

        case 'get_current_theme': {
          return {
            success: true,
            message: `Current theme: ${currentTheme.name}`,
            data: {
              id: currentTheme.id,
              name: currentTheme.name,
              variables: currentTheme.variables,
            },
          };
        }

        case 'set_theme': {
          const themeId = args.themeId as string;
          const theme = allThemes.find((t) => t.id === themeId);
          if (!theme) {
            return {
              success: false,
              message: `Theme not found: ${themeId}. Available: ${allThemes.map((t) => t.id).join(', ')}`,
            };
          }
          setThemeById(themeId);
          return {
            success: true,
            message: `Switched to theme: ${theme.name}`,
          };
        }

        case 'preview_theme': {
          const themeData = args.theme as Partial<Theme>;
          if (!themeData) {
            return { success: false, message: 'No theme data provided' };
          }

          // Create a full theme object
          const previewThemeObj: Theme = {
            id: themeData.id || `preview-${Date.now()}`,
            name: themeData.name || 'Preview Theme',
            author: themeData.author || 'AI Generated',
            version: '1.0.0',
            variables: {
              ...currentTheme.variables,
              ...(themeData.variables || {}),
            } as ThemeVariables,
            customCss: themeData.customCss,
          };

          previewTheme(previewThemeObj);
          return {
            success: true,
            message: `Previewing theme: ${previewThemeObj.name}. Use apply_preview to keep it or cancel_preview to revert.`,
          };
        }

        case 'apply_preview': {
          if (!state.previewTheme) {
            return { success: false, message: 'No theme is currently being previewed' };
          }
          applyPreview();
          return {
            success: true,
            message: 'Theme applied successfully!',
          };
        }

        case 'cancel_preview': {
          if (!state.previewTheme) {
            return { success: false, message: 'No theme is currently being previewed' };
          }
          cancelPreview();
          return {
            success: true,
            message: 'Preview cancelled, reverted to previous theme.',
          };
        }

        case 'tweak_theme': {
          const changes = args.changes as Record<string, string>;
          if (!changes || Object.keys(changes).length === 0) {
            return { success: false, message: 'No changes provided' };
          }

          // Apply each change as a preview
          for (const [key, value] of Object.entries(changes)) {
            updateVariable(key as keyof ThemeVariables, value);
          }

          return {
            success: true,
            message: `Applied ${Object.keys(changes).length} CSS variable changes. Use apply_preview to keep or cancel_preview to revert.`,
          };
        }

        case 'generate_theme': {
          // For generate_theme, we return instructions for the LLM to generate the theme
          // The LLM should respond with a preview_theme call containing the generated theme
          const description = args.description as string;
          const baseTheme = args.baseTheme as string | undefined;

          const base = baseTheme
            ? allThemes.find((t) => t.id === baseTheme)
            : currentTheme;

          return {
            success: true,
            message: `To generate a "${description}" theme, create a theme object with CSS variables. Base theme: ${base?.name || 'Modern Dark'}`,
            data: {
              instruction: 'Generate theme variables and call preview_theme with the result',
              baseVariables: base?.variables,
              description,
            },
          };
        }

        case 'save_custom_theme': {
          const themeName = args.name as string;
          if (!themeName) {
            return { success: false, message: 'Theme name is required' };
          }

          const themeToSave = state.previewTheme || currentTheme;
          const customTheme: Theme = {
            ...themeToSave,
            id: `custom-${Date.now()}`,
            name: themeName,
            author: 'User Custom',
          };

          addCustomTheme(customTheme);
          return {
            success: true,
            message: `Saved custom theme: ${themeName}`,
          };
        }

        default:
          return {
            success: false,
            message: `Unknown theme tool: ${name}`,
          };
      }
    },
    [
      allThemes,
      currentTheme,
      state.previewTheme,
      setThemeById,
      previewTheme,
      applyPreview,
      cancelPreview,
      updateVariable,
      addCustomTheme,
    ]
  );

  return {
    isThemeTool,
    executeThemeTool,
  };
}
