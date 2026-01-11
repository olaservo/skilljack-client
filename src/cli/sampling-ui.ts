/**
 * Sampling UI - CLI display for sampling requests and responses
 *
 * This module is standalone. Copy this file to add sampling UI to any MCP client CLI.
 *
 * Usage:
 *   import { createSamplingCallbacks } from './cli/sampling-ui.js';
 *
 *   setupSampling(client, {
 *     ...createSamplingCallbacks({ log, logError }),
 *   });
 */

import { createInterface } from 'node:readline';
import {
  formatContentForDisplay,
  type SamplingRequest,
  type SamplingResponse,
  type SamplingCallbacks,
} from '../capabilities/sampling.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SamplingUIConfig {
  /** Log function for output */
  log: (...args: unknown[]) => void;
}

// ============================================================================
// DISPLAY FUNCTIONS
// ============================================================================

/**
 * Display a sampling request in a formatted way.
 */
export function displaySamplingRequest(request: SamplingRequest, log: (...args: unknown[]) => void): void {
  log('\n' + '='.repeat(60));
  log('SERVER SAMPLING REQUEST');
  log('='.repeat(60));

  if (request.systemPrompt) {
    log('\n[System Prompt]');
    log(request.systemPrompt);
  }

  log('\n[Messages]');
  for (const msg of request.messages) {
    log(`  ${msg.role}: ${formatContentForDisplay(msg.content)}`);
  }

  if (request.tools && request.tools.length > 0) {
    log('\n[Tools Available]');
    for (const tool of request.tools) {
      log(`  - ${tool.name}: ${tool.description || '(no description)'}`);
    }
    if (request.toolChoice) {
      log(`  Tool choice mode: ${request.toolChoice.mode}`);
    }
  }

  log('\n[Parameters]');
  log(`  Max tokens: ${request.maxTokens ?? 'default'}`);
  if (request.temperature !== undefined) {
    log(`  Temperature: ${request.temperature}`);
  }
  log('='.repeat(60));
}

/**
 * Display a sampling response in a formatted way.
 */
export function displaySamplingResponse(response: SamplingResponse, log: (...args: unknown[]) => void): void {
  log('\n' + '-'.repeat(60));
  log('LLM RESPONSE');
  log('-'.repeat(60));

  if ('content' in response) {
    if (Array.isArray(response.content)) {
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          log(`  [Tool Use] ${block.name}`);
          log(`    Input: ${JSON.stringify(block.input)}`);
        }
      }
    } else if (response.content.type === 'text') {
      log(`  ${response.content.text}`);
    }
  }

  log(`\n  Stop reason: ${response.stopReason}`);
  log('-'.repeat(60) + '\n');
}

/**
 * Prompt user for approval of a sampling request.
 */
export async function promptForApproval(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('\nApprove this request? [Y/n]: ', (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
    });
  });
}

// ============================================================================
// CALLBACK FACTORY
// ============================================================================

/**
 * Create sampling callbacks for CLI display.
 *
 * @param config - UI configuration
 * @returns Sampling callbacks object
 */
export function createSamplingCallbacks(config: SamplingUIConfig): Pick<SamplingCallbacks, 'onApprovalRequest' | 'onResponse' | 'onLog'> {
  const { log } = config;

  return {
    onApprovalRequest: async (request: SamplingRequest) => {
      displaySamplingRequest(request, log);
      return promptForApproval();
    },

    onResponse: (response: SamplingResponse) => {
      displaySamplingResponse(response, log);
    },

    onLog: (message: string) => {
      log(message);
    },
  };
}
