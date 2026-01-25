/**
 * Tool Annotations - Warning level classification for tools
 *
 * Interprets MCP tool annotations to determine safety level for UI display
 * and confirmation prompts.
 *
 * SECURITY WARNING:
 *   Tool annotations are HINTS ONLY. Do NOT make security decisions based on
 *   annotations from untrusted servers. A malicious server could mark a
 *   destructive tool as readOnlyHint: true.
 */

import type { ToolAnnotations } from './types.js';

/**
 * Warning levels for tool safety classification.
 */
export type WarningLevel = 'safe' | 'caution' | 'danger';

/**
 * Default values when annotations are not provided.
 * These assume the MOST DANGEROUS behavior per MCP spec.
 */
export const ANNOTATION_DEFAULTS = {
  readOnlyHint: false, // Assumes tool DOES modify its environment
  destructiveHint: true, // Assumes tool IS destructive
  idempotentHint: false, // Assumes tool is NOT safe to retry
  openWorldHint: true, // Assumes tool interacts with external systems
} as const;

/**
 * Tool-like object with optional annotations.
 */
interface ToolWithAnnotations {
  annotations?: ToolAnnotations;
}

/**
 * Check if a tool is read-only (does not modify its environment).
 * Returns false (assumes modifying) if not specified.
 */
export function isReadOnly(tool: ToolWithAnnotations): boolean {
  return tool.annotations?.readOnlyHint ?? ANNOTATION_DEFAULTS.readOnlyHint;
}

/**
 * Check if a tool is destructive (performs destructive updates like deletes).
 * Returns true (assumes destructive) if not specified.
 *
 * Note: Only meaningful when readOnlyHint is false.
 */
export function isDestructive(tool: ToolWithAnnotations): boolean {
  return tool.annotations?.destructiveHint ?? ANNOTATION_DEFAULTS.destructiveHint;
}

/**
 * Check if a tool is idempotent (safe to call multiple times with same result).
 * Returns false (assumes NOT idempotent) if not specified.
 *
 * Note: Only meaningful when readOnlyHint is false.
 */
export function isIdempotent(tool: ToolWithAnnotations): boolean {
  return tool.annotations?.idempotentHint ?? ANNOTATION_DEFAULTS.idempotentHint;
}

/**
 * Check if a tool interacts with external systems (open world).
 * Returns true (assumes external interaction) if not specified.
 */
export function isOpenWorld(tool: ToolWithAnnotations): boolean {
  return tool.annotations?.openWorldHint ?? ANNOTATION_DEFAULTS.openWorldHint;
}

/**
 * Get the warning level for a tool based on its annotations.
 *
 * - 'safe': Read-only tools
 * - 'caution': Non-destructive or idempotent tools
 * - 'danger': Destructive, non-idempotent tools (or no annotations)
 */
export function getWarningLevel(tool: ToolWithAnnotations): WarningLevel {
  const annotations = tool.annotations;

  // No annotations = assume dangerous
  if (!annotations) return 'danger';

  // Read-only tools are safe
  if (annotations.readOnlyHint) return 'safe';

  // Destructive, non-idempotent tools need confirmation
  if (isDestructive(tool) && !isIdempotent(tool)) {
    return 'danger';
  }

  // Non-destructive or idempotent tools are lower risk
  if (!isDestructive(tool) || isIdempotent(tool)) {
    return 'caution';
  }

  return 'danger';
}

/**
 * Check if a tool should require user confirmation before calling.
 * Returns true for 'danger' level tools.
 */
export function requiresConfirmation(tool: ToolWithAnnotations): boolean {
  return getWarningLevel(tool) === 'danger';
}

/**
 * Get a human-readable description of why a tool has its warning level.
 * Useful for UI tooltips or explanations.
 */
export function getWarningReason(tool: ToolWithAnnotations): string {
  const annotations = tool.annotations;

  if (!annotations) {
    return 'No annotations provided - assuming dangerous behavior';
  }

  if (annotations.readOnlyHint) {
    return 'Read-only tool - does not modify environment';
  }

  if (isDestructive(tool) && !isIdempotent(tool)) {
    return 'Destructive and non-idempotent - may cause permanent changes';
  }

  if (!isDestructive(tool)) {
    return 'Non-destructive - does not delete or permanently modify data';
  }

  if (isIdempotent(tool)) {
    return 'Idempotent - safe to retry without additional side effects';
  }

  return 'May modify environment';
}

/**
 * Get CSS class suffix for a warning level.
 */
export function getWarningClass(tool: ToolWithAnnotations): string {
  return getWarningLevel(tool);
}

/**
 * Get display label for a warning level.
 */
export function getWarningLabel(level: WarningLevel): string {
  switch (level) {
    case 'safe':
      return 'Safe';
    case 'caution':
      return 'Caution';
    case 'danger':
      return 'Danger';
  }
}
