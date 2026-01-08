/**
 * Instructions Module - Combine server instructions from multiple sources
 *
 * This module is standalone. Copy this file to add instruction combining to any MCP client.
 *
 * Usage:
 *   import { combineInstructions } from './instructions.js';
 *
 *   const instructions = combineInstructions({
 *     mcpInstructions: client.getInstructions(),
 *     configInstructions: getServerInstructions(config, serverName),
 *     cliInstructions: args.instructions,
 *   });
 *
 * Sources (in order of precedence):
 *   1. MCP Server instructions - provided during server initialization
 *   2. Config file instructions - per-server instructions in mcp-client.json
 *   3. CLI instructions - one-off instructions via --instructions flag
 *
 * Security Note:
 *   Instructions are probabilistic guidance - they influence LLM behavior but don't guarantee it.
 *   Do NOT rely on instructions for security-critical operations.
 *   Use deterministic code checks, hooks, or tool-level validation for security.
 */

import { log } from './logging.js';

// ============================================================================
// TYPES
// ============================================================================

export interface InstructionsConfig {
  /** Instructions from MCP server (via client.getInstructions()) */
  mcpInstructions?: string;
  /** Instructions from client config file (per-server) */
  configInstructions?: string;
  /** Instructions from CLI --instructions flag */
  cliInstructions?: string;
}

export interface InstructionsResult {
  /** Combined instructions string, or undefined if none */
  combined?: string;
  /** Individual sources for transparency logging */
  sources: {
    mcp?: string;
    config?: string;
    cli?: string;
  };
}

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Combine instructions from multiple sources into a single string.
 *
 * Order: MCP server → Config file → CLI (each appended with double newline)
 *
 * Returns undefined if no instructions are present.
 */
export function combineInstructions(config: InstructionsConfig): string | undefined {
  const parts = [
    config.mcpInstructions,
    config.configInstructions,
    config.cliInstructions,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/**
 * Combine instructions and return detailed result for transparency logging.
 */
export function combineInstructionsWithSources(config: InstructionsConfig): InstructionsResult {
  return {
    combined: combineInstructions(config),
    sources: {
      mcp: config.mcpInstructions,
      config: config.configInstructions,
      cli: config.cliInstructions,
    },
  };
}

/**
 * Log active instructions with source attribution.
 * Shows truncated preview of each source for transparency.
 */
export function logInstructions(result: InstructionsResult): void {
  if (!result.combined) return;

  log('\nActive instructions:');

  if (result.sources.mcp) {
    const preview = truncate(result.sources.mcp, 80);
    log(`  [MCP Server] ${preview}`);
  }

  if (result.sources.config) {
    const preview = truncate(result.sources.config, 80);
    log(`  [Config] ${preview}`);
  }

  if (result.sources.cli) {
    const preview = truncate(result.sources.cli, 80);
    log(`  [CLI] ${preview}`);
  }

  log();
}

// ============================================================================
// HELPERS
// ============================================================================

function truncate(text: string, maxLength: number): string {
  // Normalize whitespace and truncate
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.substring(0, maxLength - 3) + '...';
}
