/**
 * LLM Theme Tools
 *
 * Tools for AI-powered theme generation and customization.
 * These tools allow the LLM to generate, tweak, and preview themes.
 */

// ============================================
// Theme Tool Definitions
// ============================================

/**
 * Tool definition for documentation and reference.
 * The actual AI SDK tools are defined in provider.ts.
 */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const themeTools: ToolDefinition[] = [
  {
    name: 'list_themes',
    description: 'List all available themes (built-in and custom)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_current_theme',
    description: 'Get the currently active theme with all its CSS variables',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'set_theme',
    description: 'Switch to an existing theme by ID',
    inputSchema: {
      type: 'object',
      properties: {
        themeId: {
          type: 'string',
          description: 'The ID of the theme to activate (e.g., "modern-dark", "terminal-green", "vaporwave")',
        },
      },
      required: ['themeId'],
    },
  },
  {
    name: 'preview_theme',
    description: 'Preview a theme without permanently applying it. User can then apply or cancel.',
    inputSchema: {
      type: 'object',
      properties: {
        theme: {
          type: 'object',
          description: 'Full theme object with id, name, and variables',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            variables: {
              type: 'object',
              description: 'CSS variable key-value pairs',
            },
          },
          required: ['id', 'name', 'variables'],
        },
      },
      required: ['theme'],
    },
  },
  {
    name: 'apply_preview',
    description: 'Permanently apply the currently previewed theme',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'cancel_preview',
    description: 'Cancel the current theme preview and revert to the active theme',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'tweak_theme',
    description: 'Modify specific CSS variables of the current theme. Creates a preview with the changes.',
    inputSchema: {
      type: 'object',
      properties: {
        changes: {
          type: 'object',
          description: 'Object with CSS variable names as keys and new values. Example: {"--accent": "#ff6b6b", "--bg-primary": "#1a1a2e"}',
        },
      },
      required: ['changes'],
    },
  },
  {
    name: 'generate_theme',
    description: 'Generate a complete theme based on a description. Returns a theme object that can be previewed.',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Natural language description of the desired theme (e.g., "cyberpunk neon", "cozy autumn", "ocean sunset")',
        },
        baseTheme: {
          type: 'string',
          description: 'Optional ID of a theme to use as a starting point',
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'save_custom_theme',
    description: 'Save the current preview or active theme as a custom theme',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Display name for the custom theme',
        },
      },
      required: ['name'],
    },
  },
];

// ============================================
// Theme Variable Reference
// ============================================

export const themeVariableReference = `
## Available CSS Variables for Themes

### Colors - Backgrounds
- --bg-primary: Main background color
- --bg-secondary: Secondary/elevated background
- --bg-panel: Panel/card background
- --bg-hover: Hover state background
- --bg-active: Active/pressed state background

### Colors - Text
- --text-primary: Main text color
- --text-secondary: Secondary/muted text
- --text-muted: Disabled/hint text

### Colors - Accent & Semantic
- --accent: Primary accent color (buttons, links)
- --accent-hover: Accent hover state
- --accent-muted: Subdued accent
- --success: Success/positive color (usually green)
- --error: Error/danger color (usually red)
- --warning: Warning color (usually yellow/orange)
- --info: Info color (usually blue)

### Colors - Borders
- --border: Default border color
- --border-hover: Border hover state

### Typography
- --font-family: Main font stack
- --font-mono: Monospace font stack
- --font-size-base: Base font size (default: 1rem)

### Border Radius
- --radius-sm: Small radius (4px)
- --radius-md: Medium radius (8px)
- --radius-lg: Large radius (12px)
- --radius-full: Full/pill radius (9999px)

### Shadows
- --shadow-sm: Small shadow
- --shadow-md: Medium shadow
- --shadow-lg: Large shadow
- --shadow-drawer: Chat drawer shadow

### Special Effects (for retro themes)
- --bezel-light: 3D bezel highlight color
- --bezel-dark: 3D bezel shadow color
- --glow: Text glow effect (e.g., "0 0 10px #00ff00")
- --scanlines: Scanline overlay pattern

## Color Format
Use hex colors (#rrggbb or #rgb) for all color values.
`;

// ============================================
// Theme Generation Prompt
// ============================================

export function getThemeGenerationPrompt(description: string, baseTheme?: Record<string, string>): string {
  return `Generate a cohesive color theme based on this description: "${description}"

${baseTheme ? `Starting from base theme variables:\n${JSON.stringify(baseTheme, null, 2)}` : ''}

${themeVariableReference}

Generate a complete theme with all variables. Ensure:
1. Good contrast between text and backgrounds (WCAG AA minimum)
2. Cohesive color palette that matches the description
3. Accent colors that complement the background
4. Appropriate semantic colors (success=green-ish, error=red-ish, etc.)

Return ONLY a valid JSON object with this exact structure:
{
  "id": "generated-theme-id",
  "name": "Theme Display Name",
  "variables": {
    "--bg-primary": "#hex",
    "--bg-secondary": "#hex",
    ... (all variables)
  }
}`;
}
