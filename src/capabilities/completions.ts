/**
 * Completions Capability - Argument autocomplete for prompts and resources
 *
 * This module is standalone. Copy this file to add completions support to any MCP client.
 *
 * Usage:
 *   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *   import { completePromptArgument, pickCompletion, serverSupportsCompletions } from './capabilities/completions.js';
 *
 *   // Check server support
 *   if (serverSupportsCompletions(client)) {
 *     // Programmatic usage
 *     const result = await completePromptArgument(client, 'my-prompt', 'language', 'py');
 *     console.log(result.values); // ['python', 'pydantic', ...]
 *
 *     // Interactive picker
 *     const selected = await pickCompletion(client, { type: 'ref/prompt', name: 'my-prompt' }, 'language');
 *   }
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { PromptReference, ResourceTemplateReference } from '@modelcontextprotocol/sdk/types.js';
import { createInterface } from 'node:readline';
import { log } from '../logging.js';

// ============================================================================
// TYPES
// ============================================================================

export interface CompletionResult {
  values: string[];
  total?: number;
  hasMore?: boolean;
}

export type CompletionRef = PromptReference | ResourceTemplateReference;

export interface CompletionContext {
  /** Previously-resolved arguments */
  arguments?: Record<string, string>;
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Check if server supports completions.
 */
export function serverSupportsCompletions(client: Client): boolean {
  const caps = client.getServerCapabilities();
  return caps?.completions !== undefined;
}

/**
 * Get completions for a prompt argument.
 */
export async function completePromptArgument(
  client: Client,
  promptName: string,
  argName: string,
  value: string,
  context?: CompletionContext
): Promise<CompletionResult> {
  const ref: PromptReference = { type: 'ref/prompt', name: promptName };
  return completeArgument(client, ref, argName, value, context);
}

/**
 * Get completions for a resource template argument.
 */
export async function completeResourceArgument(
  client: Client,
  templateUri: string,
  argName: string,
  value: string,
  context?: CompletionContext
): Promise<CompletionResult> {
  const ref: ResourceTemplateReference = { type: 'ref/resource', uri: templateUri };
  return completeArgument(client, ref, argName, value, context);
}

/**
 * Get completions for any ref type.
 */
export async function completeArgument(
  client: Client,
  ref: CompletionRef,
  argName: string,
  value: string,
  context?: CompletionContext
): Promise<CompletionResult> {
  const result = await client.complete({
    ref,
    argument: { name: argName, value },
    context,
  });
  return result.completion;
}

// ============================================================================
// INTERACTIVE PICKER
// ============================================================================

/**
 * Interactive picker for selecting a completion value.
 *
 * Displays a filterable list of completions. Type to filter, arrow keys to navigate,
 * Enter to select, Escape to cancel.
 *
 * @returns Selected value, or null if cancelled
 */
export async function pickCompletion(
  client: Client,
  ref: CompletionRef,
  argName: string,
  initialValue: string = '',
  context?: CompletionContext
): Promise<string | null> {
  let inputValue = initialValue;
  let selectedIndex = 0;
  let completions: CompletionResult = { values: [] };

  // Fetch initial completions
  completions = await completeArgument(client, ref, argName, inputValue, context);

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const render = () => {
      // Clear screen and move cursor to top
      process.stdout.write('\x1B[2J\x1B[H');
      log(`Completing: ${argName}`);
      log(`Filter: ${inputValue}_`);
      log('---');

      if (completions.values.length === 0) {
        log('(no completions)');
      } else {
        completions.values.forEach((val, i) => {
          const prefix = i === selectedIndex ? '> ' : '  ';
          log(`${prefix}${val}`);
        });
        if (completions.hasMore) {
          log(`  ... (${completions.total ?? 'more'} total)`);
        }
      }
      log('---');
      log('Type to filter | Up/Down to navigate | Enter to select | Esc to cancel');
    };

    const cleanup = () => {
      process.stdin.setRawMode(false);
      rl.close();
      process.stdout.write('\x1B[2J\x1B[H'); // Clear screen
    };

    render();

    process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdin.on('data', async (key: Buffer) => {
      const char = key.toString();

      // Escape
      if (char === '\x1B' || char === '\x03') {
        cleanup();
        resolve(null);
        return;
      }

      // Enter
      if (char === '\r' || char === '\n') {
        cleanup();
        resolve(completions.values[selectedIndex] ?? inputValue);
        return;
      }

      // Up arrow
      if (char === '\x1B[A') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      // Down arrow
      if (char === '\x1B[B') {
        selectedIndex = Math.min(completions.values.length - 1, selectedIndex + 1);
        render();
        return;
      }

      // Backspace
      if (char === '\x7F' || char === '\b') {
        inputValue = inputValue.slice(0, -1);
        selectedIndex = 0;
        completions = await completeArgument(client, ref, argName, inputValue, context);
        render();
        return;
      }

      // Printable character
      if (char.length === 1 && char >= ' ') {
        inputValue += char;
        selectedIndex = 0;
        completions = await completeArgument(client, ref, argName, inputValue, context);
        render();
      }
    });
  });
}
