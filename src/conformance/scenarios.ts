/**
 * Conformance Test Scenario Handlers
 *
 * Each handler performs the actions expected by the conformance test framework
 * for a specific scenario.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ConformanceContext } from './runner.js';
import { log } from '../logging.js';

/**
 * Initialize scenario - Tests MCP client initialization handshake
 *
 * Expected: Connect to server, list tools
 */
export async function runInitialize(
  client: Client,
  _context: ConformanceContext
): Promise<void> {
  // List tools to complete the initialization test
  const tools = await client.listTools();
  log(
    `[Conformance] Listed ${tools.tools.length} tools:`,
    tools.tools.map((t) => t.name).join(', ') || '(none)'
  );
}

/**
 * Tools call scenario - Tests calling tools with parameters
 *
 * Expected: Call the add_numbers tool with two numbers
 */
export async function runToolsCall(
  client: Client,
  _context: ConformanceContext
): Promise<void> {
  // List tools first
  const tools = await client.listTools();
  log(
    `[Conformance] Available tools:`,
    tools.tools.map((t) => t.name).join(', ')
  );

  // Call the add_numbers tool (expected by conformance test)
  const result = await client.callTool({
    name: 'add_numbers',
    arguments: { a: 5, b: 3 },
  });

  log(`[Conformance] Tool result:`, JSON.stringify(result));

  // Verify result contains expected content
  if (!result.content || !Array.isArray(result.content)) {
    throw new Error('Tool result missing content array');
  }

  const textContent = result.content.find(
    (c) => 'type' in c && c.type === 'text'
  );
  if (!textContent || !('text' in textContent)) {
    throw new Error('Tool result missing text content');
  }

  log(`[Conformance] Tool response: ${textContent.text}`);
}

/**
 * Set up elicitation handler BEFORE connecting
 * (Must be called before client.connect())
 */
export function setupElicitationDefaults(client: Client): void {
  // Register elicitation handler that returns empty content
  // The SDK should fill in defaults for all omitted fields
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    log(
      '[Conformance] Received elicitation request:',
      JSON.stringify(request.params, null, 2)
    );
    log(
      '[Conformance] Accepting with empty content - SDK should apply defaults'
    );

    // Return empty content - SDK should merge in defaults
    return {
      action: 'accept' as const,
      content: {},
    };
  });
}

/**
 * Elicitation defaults scenario - Tests client-side elicitation defaults
 *
 * Expected: Handle elicitation request with empty content, SDK applies defaults
 */
export async function runElicitationDefaults(
  client: Client,
  _context: ConformanceContext
): Promise<void> {
  // List available tools
  const tools = await client.listTools();
  log(
    `[Conformance] Available tools:`,
    tools.tools.map((t) => t.name).join(', ')
  );

  // Call the elicitation test tool (may be named differently in different versions)
  const testTool = tools.tools.find(
    (t) =>
      t.name === 'test_client_elicitation_defaults' ||
      t.name.startsWith('test_client_elicitation_sep1034_')
  );

  if (!testTool) {
    throw new Error('No elicitation test tool found');
  }

  log(`[Conformance] Calling ${testTool.name}...`);
  const result = await client.callTool({
    name: testTool.name,
    arguments: {},
  });
  log(`[Conformance] ${testTool.name} result:`, JSON.stringify(result));
}
