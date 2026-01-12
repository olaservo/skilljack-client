/**
 * LLM Provider
 *
 * Loosely-coupled provider abstraction using Vercel AI SDK v6.
 * Supports multiple providers (Anthropic, OpenAI) through a unified interface.
 *
 * Design goals (matching inspector-v2):
 * - Provider-agnostic interface
 * - Easy to swap providers without code changes
 * - Standardized tool format across providers
 * - Unified streaming interface
 */

import { streamText, dynamicTool, jsonSchema, stepCountIs, type ModelMessage, type ToolSet } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import type { McpTool, ChatSettings, StreamEvent } from './types.js';
import { THEME_LIST, getThemeMeta, formatThemeList } from '../shared/themes.js';

// ============================================
// Types
// ============================================

export type ProviderType = 'anthropic' | 'openai';

export interface LlmProviderConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

export interface StreamChatOptions {
  messages: ModelMessage[];
  mcpContext: {
    servers: Array<{ name: string; version?: string }>;
    availableTools: McpTool[];
  } | null;
  settings: ChatSettings;
  systemPrompt: string;
  config?: LlmProviderConfig;
}

// ============================================
// Schema Normalization
// ============================================

/**
 * Ensures a schema is a valid JSON Schema object.
 * Many MCP tools omit top-level type; Anthropic requires object.
 */
function ensureJsonSchemaObject(schema: unknown): JSONSchema7 {
  if (schema && typeof schema === 'object') {
    const record = schema as Record<string, unknown>;
    const base: JSONSchema7 = record.jsonSchema
      ? ensureJsonSchemaObject(record.jsonSchema)
      : (record as JSONSchema7);

    // Many MCP tools omit top-level type; Anthropic requires object
    if (!('type' in base) || base.type === undefined) {
      base.type = 'object';
    }
    if (base.type === 'object') {
      base.properties = (base.properties ?? {}) as Record<string, JSONSchema7Definition>;
      if (base.additionalProperties === undefined) {
        base.additionalProperties = false;
      }
    }
    return base;
  }
  return { type: 'object', properties: {}, additionalProperties: false };
}

// ============================================
// Provider Registry
// ============================================

type ProviderFactory = (apiKey?: string) => {
  getModel: (modelId: string) => ReturnType<ReturnType<typeof createAnthropic>>;
};

const providers: Record<string, ProviderFactory> = {
  anthropic: (apiKey?: string) => {
    const anthropic = createAnthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    return {
      getModel: (modelId: string) => anthropic(modelId),
    };
  },
  // Can add more providers here:
  // openai: (apiKey?: string) => { ... }
};

/**
 * Get a language model instance by provider and model ID
 */
export function getModel(
  provider: string,
  modelId: string,
  apiKey?: string
) {
  const factory = providers[provider];
  if (!factory) {
    throw new Error(`Unknown provider: ${provider}. Available: ${Object.keys(providers).join(', ')}`);
  }
  return factory(apiKey).getModel(modelId);
}

/**
 * Get available providers
 */
export function getAvailableProviders(): string[] {
  return Object.keys(providers);
}

// ============================================
// Tool Conversion - MCP to AI SDK
// ============================================

/**
 * Convert MCP tools to AI SDK tool format using dynamicTool
 */
export function convertMcpToolsToAiSdk(mcpTools: McpTool[]): ToolSet {
  const tools: ToolSet = {};

  for (const mcpTool of mcpTools) {
    const normalizedSchema = ensureJsonSchemaObject(mcpTool.inputSchema);

    tools[mcpTool.name] = dynamicTool({
      description: mcpTool.description || `Tool: ${mcpTool.originalName} (from ${mcpTool.serverName})`,
      inputSchema: jsonSchema({
        type: 'object',
        properties: normalizedSchema.properties ?? {},
        additionalProperties: normalizedSchema.additionalProperties ?? false,
        ...(normalizedSchema.required ? { required: normalizedSchema.required as string[] } : {}),
      }),
      // Tool execution happens client-side, just return the args
      execute: async (args) => ({ pending: true, args }),
    });
  }

  return tools;
}

/**
 * Add internal theme tools to the tool set.
 * These tools are executed client-side via useThemeTools hook.
 * The execute function returns a result the LLM can use to continue the conversation.
 * Theme list comes from shared/themes.ts (single source of truth).
 */
export function addThemeTools(tools: ToolSet): ToolSet {
  const themeTools: ToolSet = {
    list_themes: dynamicTool({
      description: 'List all available themes. Returns theme IDs and names.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => ({
        success: true,
        themes: THEME_LIST,
        message: `Available themes: ${formatThemeList()}`,
      }),
    }),
    get_current_theme: dynamicTool({
      description: 'Get the currently active theme with all its CSS variables',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => ({
        success: true,
        message: 'Current theme info retrieved. The UI will show the current theme details.',
      }),
    }),
    set_theme: dynamicTool({
      description: 'Switch to an existing theme by ID. Use list_themes first to see available IDs.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          themeId: {
            type: 'string',
            description: 'Theme ID (e.g., "modern-dark", "terminal-green", "vaporwave")',
          },
        },
        required: ['themeId'],
        additionalProperties: false,
      }),
      execute: async (args) => {
        const { themeId } = args as { themeId: string };
        const theme = getThemeMeta(themeId);
        if (theme) {
          return { success: true, message: `Switched to theme: ${theme.name}` };
        }
        return { success: false, message: `Theme not found: ${themeId}. Available: ${THEME_LIST.map(t => t.id).join(', ')}` };
      },
    }),
    preview_theme: dynamicTool({
      description: 'Preview a theme without applying permanently. Provide a theme object with variables.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          theme: {
            type: 'object',
            description: 'Theme object with id, name, and variables (CSS variable key-value pairs)',
          },
        },
        required: ['theme'],
        additionalProperties: false,
      }),
      execute: async (args) => {
        const { theme } = args as { theme: { name?: string } };
        return {
          success: true,
          message: `Previewing theme: ${theme?.name || 'Custom Theme'}. Use apply_preview to keep it or cancel_preview to revert.`,
        };
      },
    }),
    apply_preview: dynamicTool({
      description: 'Permanently apply the currently previewed theme',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => ({ success: true, message: 'Theme applied successfully!' }),
    }),
    cancel_preview: dynamicTool({
      description: 'Cancel the current theme preview and revert to the previous theme',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => ({ success: true, message: 'Preview cancelled, reverted to previous theme.' }),
    }),
    tweak_theme: dynamicTool({
      description: 'Modify specific CSS variables of the current theme. Creates a preview with changes.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          changes: {
            type: 'object',
            description: 'CSS variable changes (e.g., {"--accent": "#ff6b6b", "--bg-primary": "#1a1a2e"})',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['changes'],
        additionalProperties: false,
      }),
      execute: async (args) => {
        const { changes } = args as { changes: Record<string, string> };
        const count = Object.keys(changes || {}).length;
        return {
          success: true,
          message: `Applied ${count} CSS variable change(s). Use apply_preview to keep or cancel_preview to revert.`,
        };
      },
    }),
    generate_theme: dynamicTool({
      description: 'Generate a new theme from a description. After calling this, use preview_theme with your generated theme object.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Theme description (e.g., "cyberpunk neon", "cozy autumn", "ocean sunset")',
          },
          baseTheme: {
            type: 'string',
            description: 'Optional ID of theme to start from',
          },
        },
        required: ['description'],
        additionalProperties: false,
      }),
      execute: async (args) => {
        const { description } = args as { description: string; baseTheme?: string };
        return {
          success: true,
          message: `Ready to generate "${description}" theme. Now create a theme object with CSS variables and call preview_theme.`,
          instruction: 'Generate a complete theme with these CSS variables: --bg-primary, --bg-secondary, --bg-panel, --text-primary, --text-secondary, --accent, --accent-hover, --border, --success, --error, --warning. Then call preview_theme with the theme object.',
        };
      },
    }),
    save_custom_theme: dynamicTool({
      description: 'Save the current preview or active theme as a custom theme',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Display name for the custom theme',
          },
        },
        required: ['name'],
        additionalProperties: false,
      }),
      execute: async (args) => {
        const { name } = args as { name: string };
        return { success: true, message: `Saved custom theme: ${name}` };
      },
    }),
  };

  return { ...tools, ...themeTools };
}

// ============================================
// Streaming Chat
// ============================================

/**
 * Parse qualified tool name into server and tool parts
 */
function parseQualifiedName(qualifiedName: string): { serverName: string; toolName: string } {
  const separatorIndex = qualifiedName.indexOf('__');
  if (separatorIndex === -1) {
    return { serverName: 'default', toolName: qualifiedName };
  }
  return {
    serverName: qualifiedName.slice(0, separatorIndex),
    toolName: qualifiedName.slice(separatorIndex + 2),
  };
}

/**
 * Stream a chat response from the LLM.
 * Returns an async generator of stream events.
 */
export async function* streamChat(options: StreamChatOptions): AsyncGenerator<StreamEvent> {
  const { messages, mcpContext, settings, systemPrompt, config } = options;
  const provider = settings.provider || 'anthropic';
  const apiKey = config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    yield { type: 'text', content: `[No ${provider} API key configured]\n\n` };
    yield { type: 'done' };
    return;
  }

  const modelId = settings.modelId || 'claude-sonnet-4-5-20250929';
  const model = getModel(provider, modelId, apiKey);

  // Convert MCP tools to AI SDK format
  let tools: ToolSet | undefined;
  if (mcpContext?.availableTools && mcpContext.availableTools.length > 0) {
    tools = convertMcpToolsToAiSdk(mcpContext.availableTools);
    tools = addThemeTools(tools);
  } else {
    // Still add theme tools even without MCP tools
    tools = addThemeTools({});
  }

  // Stream the response (v6 API uses maxOutputTokens)
  const result = streamText({
    model,
    messages,
    system: systemPrompt,
    maxOutputTokens: settings.maxTokens || 4096,
    temperature: settings.temperature ?? 0.7,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
    // Single step - tool results aren't fed back to LLM (execution is client-side)
    // Multi-step would just confuse the LLM with fake { pending: true } results
    stopWhen: stepCountIs(1),
  });

  // Iterate over the full stream (v6 API)
  for await (const chunk of result.fullStream) {
    switch (chunk.type) {
      case 'text-delta':
        // v6: property is 'text' not 'textDelta'
        yield { type: 'text', content: chunk.text };
        break;

      case 'tool-call': {
        // v6: property is 'input' not 'args'
        const toolInput = chunk.input ?? {};
        const { serverName, toolName } = parseQualifiedName(chunk.toolName);
        yield {
          type: 'tool_call_start',
          toolCall: {
            id: chunk.toolCallId,
            name: chunk.toolName,
            displayName: toolName,
            serverName,
            arguments: toolInput as Record<string, unknown>,
          },
        };
        break;
      }

      case 'finish':
        // v6: property is 'totalUsage', with inputTokens/outputTokens
        yield {
          type: 'done',
          usage: chunk.totalUsage ? {
            inputTokens: chunk.totalUsage.inputTokens ?? 0,
            outputTokens: chunk.totalUsage.outputTokens ?? 0,
          } : undefined,
        };
        break;

      case 'error':
        yield {
          type: 'error',
          message: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
        };
        break;
    }
  }
}

// ============================================
// Default Settings
// ============================================

export const defaultSettings: ChatSettings = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-5-20250929',
  temperature: 0.7,
  maxTokens: 4096,
};

/**
 * Merge user settings with defaults
 */
export function mergeSettings(userSettings?: Partial<ChatSettings>): ChatSettings {
  return {
    ...defaultSettings,
    ...userSettings,
  };
}
