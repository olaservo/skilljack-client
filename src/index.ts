#!/usr/bin/env node
/**
 * MCP Skilljack Client - CLI Demo
 *
 * Demonstrates composing standalone capabilities into a full-featured client.
 *
 * Usage:
 *   npm start -- --stdio "node server.js"
 *   npm start -- --url http://localhost:3000/mcp
 *   npm start -- --conformance <scenario> <server-url>
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import 'dotenv/config';

// Import CLI modules
import { parseArgs, getHelpText } from './cli/args.js';
import { createSamplingCallbacks } from './cli/sampling-ui.js';
import { runRepl, printCommands } from './cli/repl.js';

// Import persistent task store
import { createPersistentTaskStore } from './stores/index.js';

// Import standalone capabilities
import { setupSampling } from './capabilities/sampling.js';
import { setupElicitation } from './capabilities/elicitation.js';
import { setupRoots } from './capabilities/roots.js';
import {
  setupLogging,
  setLoggingLevel,
  serverSupportsLogging,
} from './capabilities/logging.js';
import { serverSupportsCompletions } from './capabilities/completions.js';
import { serverSupportsTasks } from './capabilities/tasks.js';
import { setupListChanged } from './capabilities/list-changed.js';
import { setupSubscriptions, serverSupportsSubscriptions } from './capabilities/subscriptions.js';

// Import instructions and config modules
import { combineInstructionsWithSources, logInstructions } from './instructions.js';
import { loadConfig, getServerInstructions } from './config.js';

// Import client logging (routes to stderr in stdio mode)
import { log, logError, setStdioMode } from './logging.js';

// Import conformance runner
import { runConformanceScenario } from './conformance/runner.js';

// Import multi-server support
import { loadMultiServerConfig, connectToAllServers, disconnectAll } from './multi-server.js';

async function main() {
  const argv = process.argv.slice(2);

  // Detect stdio mode early and route all output to stderr
  if (argv.includes('--stdio')) {
    setStdioMode(true);
  }

  // Parse CLI arguments
  const parseResult = parseArgs(argv);
  if (!parseResult.success) {
    logError(parseResult.error.message);
    process.exit(parseResult.error.exitCode);
  }

  const args = parseResult.args;

  // Handle help
  if (args.help) {
    log(getHelpText());
    return;
  }

  // Handle conformance mode
  if (args.conformance) {
    try {
      await runConformanceScenario(args.conformance.scenario, args.conformance.serverUrl);
      process.exit(0);
    } catch (error) {
      logError('[Conformance] Error:', error);
      process.exit(1);
    }
  }

  // Build capabilities based on flags
  const capabilities: Record<string, unknown> = {};
  if (args.enableSampling) capabilities.sampling = { tools: {} };
  if (args.roots.length) capabilities.roots = { listChanged: true };
  capabilities.elicitation = { form: {} };
  capabilities.tasks = {
    list: {},
    cancel: {},
    requests: {
      sampling: { createMessage: {} },
      elicitation: { create: {} },
    },
  };

  // Multi-server web mode: skip single transport requirement
  if (args.webPort !== undefined && args.serversConfigPath) {
    const { startMultiServerWebServer } = await import('./web/server.js');
    const { startSandboxServer } = await import('./web/sandbox-server.js');

    log('Loading multi-server configuration...');
    const multiConfig = await loadMultiServerConfig(args.serversConfigPath);

    log(`Connecting to ${Object.keys(multiConfig.mcpServers).length} server(s)...`);
    const clients = await connectToAllServers(multiConfig, {
      capabilities,
      continueOnError: true,
      onConnect: (name) => log(`  Connected: ${name}`),
      onError: (name, err) => logError(`  Failed: ${name} - ${err.message}`),
    });

    if (clients.size === 0) {
      logError('No servers connected');
      process.exit(1);
    }

    const sandboxPort = args.webPort + 1;
    await startSandboxServer({
      port: sandboxPort,
      allowedHost: `localhost:${args.webPort}`,
      onLog: log,
    });

    await startMultiServerWebServer({
      port: args.webPort,
      sandboxPort,
      clients,
      onLog: log,
    });

    log(`\nWeb UI available at http://localhost:${args.webPort}`);
    log('Press Ctrl+C to exit.\n');

    // Keep process alive
    await new Promise(() => {});
    return;
  }

  // Single server mode requires transport
  if (!args.transport) {
    logError('Error: Specify --stdio or --url (or use --servers with --web for multi-server mode)');
    process.exit(1);
  }

  // Load client config file
  const config = loadConfig(args.configPath);

  // Create task store for client-side task support
  const clientTaskStore = createPersistentTaskStore({
    dataDir: join(homedir(), '.skilljack', 'data'),
    persistenceEnabled: true,
    onLog: (msg) => log(msg),
  });

  // Create client with task store
  const client = new Client(
    { name: 'mcp-skilljack-client', version: '0.1.0' },
    { capabilities, taskStore: clientTaskStore }
  );

  // Set up capabilities that don't need server instructions
  setupElicitation(client, {
    onLog: (msg: string) => log(msg),
  });

  if (args.roots.length) {
    setupRoots(client, args.roots);
  }

  setupLogging(client, (level, logger, data) => {
    log(`[${level}]${logger ? ` ${logger}:` : ''}`, data ?? '');
  });

  setupListChanged(client, {
    onToolsChanged: (tools) => {
      log(`[List Changed] Tools updated: ${tools.map(t => t.name).join(', ') || 'none'}`);
    },
    onPromptsChanged: (prompts) => {
      log(`[List Changed] Prompts updated: ${prompts.map(p => p.name).join(', ') || 'none'}`);
    },
    onResourcesChanged: (resources) => {
      log(`[List Changed] Resources updated: ${resources.map(r => r.uri).join(', ') || 'none'}`);
    },
  });

  setupSubscriptions(client, (uri) => {
    log(`[Subscription] Resource updated: ${uri}`);
  });

  // Connect
  log('Connecting...');
  await client.connect(args.transport);
  log('Connected!\n');

  // Get server info for instructions lookup
  const serverInfo = client.getServerVersion();
  const serverName = serverInfo?.name ?? 'unknown';

  // Combine instructions from all sources
  const mcpInstructions = args.noServerInstructions ? undefined : client.getInstructions();
  const configInstructions = getServerInstructions(config, serverName);
  const instructionsResult = combineInstructionsWithSources({
    mcpInstructions,
    configInstructions,
    cliInstructions: args.cliInstructions,
  });

  // Log active instructions for transparency
  logInstructions(instructionsResult);

  // Set up sampling with combined instructions (after connect so we have server info)
  if (args.enableSampling) {
    setupSampling(client, {
      apiKey: process.env.ANTHROPIC_API_KEY,
      approvalMode: args.approvalMode,
      serverInstructions: instructionsResult.combined,
      ...createSamplingCallbacks({ log }),
    });
  }

  // List capabilities
  let toolsList: Awaited<ReturnType<typeof client.listTools>>['tools'] = [];
  try {
    const tools = await client.listTools();
    toolsList = tools.tools;
    log('Tools:', toolsList.map(t => t.name).join(', ') || 'none');
  } catch { /* server may not support */ }

  try {
    const prompts = await client.listPrompts();
    log('Prompts:', prompts.prompts.map(p => p.name).join(', ') || 'none');
  } catch { /* server may not support */ }

  try {
    const resources = await client.listResources();
    log('Resources:', resources.resources.map(r => r.uri).join(', ') || 'none');
  } catch { /* server may not support */ }

  if (serverSupportsCompletions(client)) {
    log('Completions: supported');
  }

  if (serverSupportsSubscriptions(client)) {
    log('Subscriptions: supported');
  }

  if (serverSupportsTasks(client)) {
    log('Tasks: supported');
  }

  if (serverSupportsLogging(client)) {
    await setLoggingLevel(client, args.logLevel);
    log(`Logging: level set to "${args.logLevel}"`);
  }

  // Web mode (single server): start web server and exit REPL
  // Note: Multi-server web mode is handled earlier, before transport check
  if (args.webPort !== undefined) {
    const { startWebServer } = await import('./web/server.js');
    const { startSandboxServer } = await import('./web/sandbox-server.js');

    const sandboxPort = args.webPort + 1;
    await startSandboxServer({
      port: sandboxPort,
      allowedHost: `localhost:${args.webPort}`,
      onLog: log,
    });

    await startWebServer({
      port: args.webPort,
      sandboxPort,
      client,
      onLog: log,
    });

    log(`\nWeb UI available at http://localhost:${args.webPort}`);
    log('Press Ctrl+C to exit.\n');

    // Keep process alive - the servers are running
    await new Promise(() => {});
    return;
  }

  // Print commands and run REPL
  printCommands(log);
  await runRepl(client, toolsList, { log, logError, logLevel: args.logLevel });

  await client.close();
}

main().catch(logError);
