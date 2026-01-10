/**
 * Capability modules - each is standalone and can be used independently.
 */

export {
  setupSampling,
  formatContentForDisplay,
  type SamplingConfig,
  type SamplingRequest,
  type SamplingResponse,
  type SamplingCallbacks,
  type SamplingMessage,
  type Tool,
  type ToolChoice,
  type ApprovalMode,
} from './sampling.js';
export { setupElicitation, type ElicitationConfig, type ElicitationResult } from './elicitation.js';
export { setupRoots, pathToRoot } from './roots.js';
export { setupListChanged, type ListChangedCallbacks } from './list-changed.js';
export { setupSubscriptions, serverSupportsSubscriptions } from './subscriptions.js';
export { setupLogging, serverSupportsLogging, type LoggingLevel } from './logging.js';
export {
  serverSupportsCompletions,
  completePromptArgument,
  completeResourceArgument,
  completeArgument,
  pickCompletion,
  type CompletionResult,
  type CompletionRef,
  type CompletionContext,
} from './completions.js';
export {
  serverSupportsTasks,
  getToolTaskSupport,
  shouldUseTaskMode,
  callToolWithTaskSupport,
  callToolAuto,
  listTasks,
  getTask,
  cancelTask,
  formatTaskForDisplay,
  formatTaskStatusLine,
  type TaskCallbacks,
  type TaskSupportLevel,
} from './tasks.js';
export {
  setupClientTasks,
  type ClientTasksConfig,
} from './client-tasks.js';
