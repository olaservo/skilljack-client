/**
 * System Prompt Builder
 *
 * Builds the system prompt with MCP context for multi-server tool awareness.
 */

import type { McpContext, McpTool } from './types.js';

/**
 * Build the system prompt with MCP context
 */
export function buildSystemPrompt(context: McpContext, customPrompt?: string): string {
  const parts: string[] = [];

  // Base prompt
  parts.push(`You are an AI assistant with access to MCP (Model Context Protocol) servers.
You can use tools to help users with various tasks. When you need to use a tool,
call it by its qualified name (server__tool format).`);

  // Custom prompt
  if (customPrompt) {
    parts.push(`\n## Additional Instructions\n${customPrompt}`);
  }

  // Connected servers
  if (context.servers.length > 0) {
    parts.push('\n## Connected MCP Servers');
    for (const server of context.servers) {
      const version = server.version ? ` (v${server.version})` : '';
      parts.push(`- **${server.name}**${version}`);
    }
  }

  // Available tools
  if (context.availableTools.length > 0) {
    parts.push('\n## Available Tools');
    parts.push('Tools are identified by qualified names: `server__tool`\n');

    // Group tools by server
    const toolsByServer = groupToolsByServer(context.availableTools);

    for (const [serverName, tools] of Object.entries(toolsByServer)) {
      parts.push(`### Server: ${serverName}`);
      for (const tool of tools) {
        parts.push(formatTool(tool));
      }
      parts.push('');
    }
  }

  // Theme tools (always available as internal tools)
  parts.push(`## Theme Tools (Internal)

You can also modify the application's appearance using these internal tools:

### generate_theme
Generate a new theme from a description.
- **description** (required): Theme description (e.g., "cyberpunk neon", "cozy autumn")
- **baseTheme** (optional): ID of theme to start from

### tweak_theme
Modify specific CSS variables of the current theme.
- **changes** (required): Object with CSS variable changes (e.g., {"--accent": "#ff6b6b"})

### preview_theme
Preview a theme without applying permanently.
- **theme** (required): Full theme object or partial changes
- **duration** (optional): Preview duration in seconds (default: 10)

### apply_theme
Apply the currently previewed theme permanently.

### list_themes
List all available themes in the gallery.
`);

  return parts.join('\n');
}

/**
 * Group tools by server name
 */
function groupToolsByServer(tools: McpTool[]): Record<string, McpTool[]> {
  const grouped: Record<string, McpTool[]> = {};
  for (const tool of tools) {
    const server = tool.serverName || 'default';
    if (!grouped[server]) {
      grouped[server] = [];
    }
    grouped[server].push(tool);
  }
  return grouped;
}

/**
 * Format a single tool for the system prompt
 */
function formatTool(tool: McpTool): string {
  const lines: string[] = [];
  lines.push(`#### ${tool.name}`);

  if (tool.description) {
    lines.push(tool.description);
  }

  if (tool.inputSchema && typeof tool.inputSchema === 'object') {
    const properties = (tool.inputSchema as { properties?: Record<string, { type?: string; description?: string }> }).properties;
    const required = (tool.inputSchema as { required?: string[] }).required || [];

    if (properties && Object.keys(properties).length > 0) {
      lines.push('\n**Parameters:**');
      for (const [name, prop] of Object.entries(properties)) {
        const isRequired = required.includes(name);
        const reqLabel = isRequired ? ' (required)' : ' (optional)';
        const typeLabel = prop.type ? ` \`${prop.type}\`` : '';
        const desc = prop.description ? `: ${prop.description}` : '';
        lines.push(`- **${name}**${reqLabel}${typeLabel}${desc}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Get theme tools definition for the AI SDK
 */
export function getThemeTools() {
  return {
    generate_theme: {
      description: 'Generate a new theme from a description',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Theme description (e.g., "cyberpunk neon", "cozy autumn")',
          },
          baseTheme: {
            type: 'string',
            description: 'Optional ID of theme to start from',
          },
        },
        required: ['description'],
      },
    },
    tweak_theme: {
      description: 'Modify specific CSS variables of the current theme',
      parameters: {
        type: 'object',
        properties: {
          changes: {
            type: 'object',
            description: 'CSS variable changes (e.g., {"--accent": "#ff6b6b"})',
          },
        },
        required: ['changes'],
      },
    },
    preview_theme: {
      description: 'Preview a theme without applying permanently',
      parameters: {
        type: 'object',
        properties: {
          theme: {
            type: 'object',
            description: 'Full theme object or partial variable changes',
          },
          duration: {
            type: 'number',
            description: 'Preview duration in seconds (default: 10)',
          },
        },
        required: ['theme'],
      },
    },
    apply_theme: {
      description: 'Apply the currently previewed theme permanently',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    list_themes: {
      description: 'List all available themes in the gallery',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  };
}
