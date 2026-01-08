/**
 * Elicitation Capability - Handle server-initiated user input requests
 *
 * This module is standalone. Copy this file to add elicitation support to any MCP client.
 *
 * Usage:
 *   import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *   import { setupElicitation } from './capabilities/elicitation.js';
 *
 *   const client = new Client(
 *     { name: 'my-client', version: '1.0.0' },
 *     { capabilities: { elicitation: { form: {}, url: {} } } }
 *   );
 *
 *   setupElicitation(client);
 *   await client.connect(transport);
 */

import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../logging.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ElicitationConfig {
  /** Custom handler for form mode (default: terminal prompt) */
  onForm?: (message: string, schema?: Record<string, unknown>) => Promise<ElicitResult>;
  /** Custom handler for URL mode (default: log URL to console) */
  onUrl?: (url: string, message: string) => Promise<ElicitResult>;
}

// Re-export the SDK type for convenience
export type { ElicitResult as ElicitationResult };

// ============================================================================
// SETUP FUNCTION
// ============================================================================

/**
 * Set up elicitation capability on a client.
 *
 * The client must declare `elicitation: { form: {}, url: {} }` in its capabilities.
 */
export function setupElicitation(client: Client, config: ElicitationConfig = {}): void {
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    const { params } = request;

    if (params.mode === 'url') {
      return handleUrlMode(params, config.onUrl);
    }

    return handleFormMode(params, config.onForm);
  });
}

// ============================================================================
// MODE HANDLERS
// ============================================================================

async function handleFormMode(
  params: { message: string; requestedSchema?: Record<string, unknown> },
  customHandler?: ElicitationConfig['onForm']
): Promise<ElicitResult> {
  if (customHandler) {
    return customHandler(params.message, params.requestedSchema);
  }

  // Default: terminal prompt with CLI output
  log(`\n[Elicitation] ${params.message}`);
  const readline = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const schema = params.requestedSchema as {
      type?: string;
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    } | undefined;

    // If schema has properties, collect structured input
    if (schema?.type === 'object' && schema.properties) {
      const content: Record<string, string | number | boolean | string[]> = {};

      for (const [key, prop] of Object.entries(schema.properties)) {
        const required = schema.required?.includes(key) ? ' (required)' : '';
        const desc = prop.description ? ` - ${prop.description}` : '';

        const value = await question(readline, `  ${key}${required}${desc}: `);

        if (prop.type === 'boolean') {
          content[key] = ['true', 'yes', 'y', '1'].includes(value.toLowerCase());
        } else if (prop.type === 'number' || prop.type === 'integer') {
          content[key] = Number(value);
        } else {
          content[key] = value;
        }
      }

      return { action: 'accept', content };
    }

    // Simple yes/no
    const response = await question(readline, '  Accept? (y/n): ');
    const accepted = ['y', 'yes'].includes(response.toLowerCase());

    return {
      action: accepted ? 'accept' : 'decline',
      content: accepted ? { confirm: true } : undefined,
    };
  } finally {
    readline.close();
  }
}

async function handleUrlMode(
  params: { message: string; requestedSchema?: Record<string, unknown> },
  customHandler?: ElicitationConfig['onUrl']
): Promise<ElicitResult> {
  const schema = params.requestedSchema as { url?: string } | undefined;
  const url = schema?.url;

  if (!url) {
    // No URL provided - decline silently (custom handler would have been called with empty URL anyway)
    return { action: 'decline' };
  }

  if (customHandler) {
    return customHandler(url, params.message);
  }

  // Default: CLI output and accept
  log(`\n[Elicitation] ${params.message}`);
  log(`  URL: ${url}`);
  log('  (Open this URL in your browser)');
  return { action: 'accept', content: { redirected: true } };
}

// ============================================================================
// HELPERS
// ============================================================================

function question(readline: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise(resolve => {
    readline.question(prompt, answer => resolve(answer.trim()));
  });
}
