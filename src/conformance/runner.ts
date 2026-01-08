/**
 * Conformance Test Runner
 *
 * Orchestrates running MCP conformance test scenarios against the skilljack client.
 * The conformance framework spawns this client with a server URL, and we connect
 * and perform scenario-specific tests.
 *
 * Usage:
 *   node dist/index.js --conformance <scenario> <server-url>
 *
 * Environment:
 *   MCP_CONFORMANCE_CONTEXT - Optional JSON with scenario-specific data
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  runInitialize,
  runToolsCall,
  runElicitationDefaults,
  setupElicitationDefaults,
} from './scenarios.js';
import { log, logError } from '../logging.js';

export interface ConformanceContext {
  [key: string]: unknown;
}

/**
 * Parse conformance context from environment variable
 */
export function parseConformanceContext(): ConformanceContext {
  const contextEnv = process.env.MCP_CONFORMANCE_CONTEXT;
  if (!contextEnv) {
    return {};
  }
  try {
    return JSON.parse(contextEnv) as ConformanceContext;
  } catch (e) {
    logError('Failed to parse MCP_CONFORMANCE_CONTEXT:', e);
    return {};
  }
}

/**
 * Create a client configured for conformance testing
 */
export function createConformanceClient(scenario: string): Client {
  // Determine capabilities based on scenario
  const capabilities: Record<string, unknown> = {};

  if (
    scenario === 'elicitation-defaults' ||
    scenario === 'elicitation-sep1034-client-defaults'
  ) {
    capabilities.elicitation = { applyDefaults: true };
  }

  return new Client(
    { name: 'mcp-skilljack-client', version: '0.1.0' },
    { capabilities }
  );
}

/**
 * Run a conformance test scenario
 */
export async function runConformanceScenario(
  scenario: string,
  serverUrl: string
): Promise<void> {
  log(`[Conformance] Running scenario: ${scenario}`);
  log(`[Conformance] Server URL: ${serverUrl}`);

  const context = parseConformanceContext();
  if (Object.keys(context).length > 0) {
    log(`[Conformance] Context:`, JSON.stringify(context));
  }

  const client = createConformanceClient(scenario);
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl));

  // Set up handlers BEFORE connecting (required for elicitation)
  if (
    scenario === 'elicitation-defaults' ||
    scenario === 'elicitation-sep1034-client-defaults'
  ) {
    setupElicitationDefaults(client);
  }

  try {
    await client.connect(transport);
    log('[Conformance] Connected to server');

    // Dispatch to scenario handler
    switch (scenario) {
      case 'initialize':
        await runInitialize(client, context);
        break;
      case 'tools-call':
      case 'tools_call':
        await runToolsCall(client, context);
        break;
      case 'elicitation-defaults':
      case 'elicitation-sep1034-client-defaults':
        await runElicitationDefaults(client, context);
        break;
      default:
        throw new Error(`Unknown scenario: ${scenario}`);
    }

    log(`[Conformance] Scenario "${scenario}" passed`);
  } finally {
    await transport.close();
    log('[Conformance] Connection closed');
  }
}
