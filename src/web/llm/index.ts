/**
 * LLM Module
 *
 * Exports for the LLM chat API.
 */

export { createChatHandler, createToolExecuteHandler } from './routes.js';
export {
  getModel,
  getAvailableProviders,
  convertMcpToolsToAiSdk,
  addThemeTools,
  streamChat,
  defaultSettings,
  mergeSettings
} from './provider.js';
export { buildSystemPrompt } from './system-prompt.js';
export type * from './types.js';
