/**
 * Settings Module
 *
 * Doer vs Dreamer dual-model configuration.
 */

export { SettingsProvider, useSettings } from './SettingsContext.js';
export { SettingsDialog } from './SettingsDialog.js';
export type {
  Provider,
  ModelConfig,
  ModelSettings,
  ModelOption,
  ToolSettings,
  SettingsState,
  SettingsAction,
} from './types.js';
export {
  defaultModelSettings,
  defaultToolSettings,
  anthropicModels,
  openaiModels,
  getModelsForProvider,
} from './types.js';
