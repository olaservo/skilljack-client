/**
 * Model Settings Types
 *
 * Defines the Doer vs Dreamer dual-model architecture.
 * - Doer: Fast, action-oriented model for getting things done
 * - Dreamer: Thoughtful model for complex reasoning
 */

export type Provider = 'anthropic' | 'openai';

export interface ModelConfig {
  provider: Provider;
  modelId: string;
  temperature: number; // 0.0-1.0
  maxTurns: number; // Max reasoning/tool steps
}

export interface ModelSettings {
  doer: ModelConfig; // Fast, action-oriented
  dreamer: ModelConfig; // Thoughtful, complex reasoning
}

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
}

// ============================================
// Available Models
// ============================================

export const anthropicModels: ModelOption[] = [
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: 'Fast & efficient' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Balanced' },
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', description: 'Most capable' },
];

export const openaiModels: ModelOption[] = [
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'Fast & efficient' },
  { id: 'gpt-5.2', name: 'GPT-5.2', description: 'Balanced' },
  { id: 'gpt-5.2-pro', name: 'GPT-5.2 Pro', description: 'Most capable' },
];

export function getModelsForProvider(provider: Provider): ModelOption[] {
  switch (provider) {
    case 'anthropic':
      return anthropicModels;
    case 'openai':
      return openaiModels;
    default:
      return [];
  }
}

// ============================================
// Defaults
// ============================================

export const defaultModelSettings: ModelSettings = {
  doer: {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    temperature: 0.3, // Low for deterministic task execution
    maxTurns: 1, // Single step - fast and focused
  },
  dreamer: {
    provider: 'anthropic',
    modelId: 'claude-opus-4-5-20251101',
    temperature: 0.8, // Higher for creative reasoning
    maxTurns: 10, // Multiple steps for complex problem solving
  },
};

// ============================================
// State & Actions
// ============================================

// ============================================
// Tool Settings
// ============================================

export interface ToolSettings {
  /** Always confirm before executing dangerous tools */
  confirmDangerousTools: boolean;
}

export const defaultToolSettings: ToolSettings = {
  confirmDangerousTools: true, // Safe default - require confirmation
};

// ============================================
// State & Actions
// ============================================

export interface SettingsState {
  models: ModelSettings;
  tools: ToolSettings;
}

export type SettingsAction =
  | { type: 'SET_DOER'; config: ModelConfig }
  | { type: 'SET_DREAMER'; config: ModelConfig }
  | { type: 'SET_CONFIRM_DANGEROUS_TOOLS'; enabled: boolean }
  | { type: 'RESET_DEFAULTS' };
