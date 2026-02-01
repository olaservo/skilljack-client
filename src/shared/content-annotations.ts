/**
 * Content Annotations Utilities
 *
 * Provides functions for handling MCP content annotations,
 * particularly audience-based filtering of tool result content.
 */

import type { ContentAnnotations } from './types.js';

/**
 * Sensible default when annotations not provided.
 * Content goes to both user and assistant.
 */
const DEFAULT_AUDIENCE: readonly ('user' | 'assistant')[] = ['user', 'assistant'];

/**
 * Get the audience for content, with sensible default.
 */
export function getAudience(
  annotations?: ContentAnnotations
): Array<'user' | 'assistant'> {
  return annotations?.audience ?? [...DEFAULT_AUDIENCE];
}

/**
 * Check if content is intended for the user.
 */
export function isForUser(annotations?: ContentAnnotations): boolean {
  return getAudience(annotations).includes('user');
}

/**
 * Check if content is intended for the assistant/LLM.
 */
export function isForAssistant(annotations?: ContentAnnotations): boolean {
  return getAudience(annotations).includes('assistant');
}

/**
 * Filter content items by audience.
 * Items without annotations default to both audiences.
 */
export function filterContentByAudience<
  T extends { annotations?: ContentAnnotations },
>(items: T[], audience: 'user' | 'assistant'): T[] {
  return items.filter((item) => {
    const itemAudience = getAudience(item.annotations);
    return itemAudience.includes(audience);
  });
}
