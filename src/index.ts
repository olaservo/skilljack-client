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
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js';
import { createInterface } from 'node:readline';
import 'dotenv/config';

// Import standalone capabilities
import {
  setupSampling,
  formatContentForDisplay,
  type SamplingRequest,
  type SamplingResponse,
} from './capabilities/sampling.js';

// Import instructions and config modules
import { combineInstructionsWithSources, logInstructions } from './instructions.js';
import { loadConfig, getServerInstructions } from './config.js';
import { setupElicitation } from './capabilities/elicitation.js';
import { setupRoots } from './capabilities/roots.js';
import {
  setupLogging,
  setLoggingLevel,
  serverSupportsLogging,
  isValidLoggingLevel,
  LOGGING_LEVELS,
  type LoggingLevel,
} from './capabilities/logging.js';
import {
  serverSupportsCompletions,
  completePromptArgument,
  completeResourceArgument,
  pickCompletion,
} from './capabilities/completions.js';
import {
  serverSupportsTasks,
  shouldUseTaskMode,
  callToolWithTaskSupport,
  listTasks,
  getTask,
  cancelTask,
  formatTaskForDisplay,
  formatTaskStatusLine,
} from './capabilities/tasks.js';
import { setupClientTasks } from './capabilities/client-tasks.js';
import { setupListChanged } from './capabilities/list-changed.js';
import { setupSubscriptions, serverSupportsSubscriptions } from './capabilities/subscriptions.js';

// Import transport helpers
import { createStdioTransport } from './transports/stdio.js';
import { createHttpTransport } from './transports/http.js';

// Import client logging (routes to stderr in stdio mode)
import { log, logError, setStdioMode } from './logging.js';

// Import conformance runner
import { runConformanceScenario } from './conformance/runner.js';

async function main() {
  const args = process.argv.slice(2);

  // Detect stdio mode early and route all output to stderr
  // This prevents corrupting the JSON-RPC protocol stream on stdout
  if (args.includes('--stdio')) {
    setStdioMode(true);
  }

  // Check for conformance mode first
  const conformanceIndex = args.indexOf('--conformance');
  if (conformanceIndex !== -1) {
    // Conformance mode: --conformance <scenario> <server-url>
    // OR: --conformance <server-url> (scenario passed by framework, URL is last arg)
    const remainingArgs = args.slice(conformanceIndex + 1);

    // The server URL is always the last argument (passed by conformance framework)
    const serverUrl = remainingArgs[remainingArgs.length - 1];

    // If there's a scenario specified, use it; otherwise infer from context
    // Note: conformance framework passes URL as last arg, so we check if first arg looks like a scenario
    let scenario = 'initialize'; // default
    if (remainingArgs.length >= 2 && !remainingArgs[0].startsWith('http')) {
      scenario = remainingArgs[0];
    }

    if (!serverUrl || !serverUrl.startsWith('http')) {
      logError('Usage: --conformance [scenario] <server-url>');
      logError('Scenarios: initialize, tools-call, elicitation-defaults');
      process.exit(1);
    }

    try {
      await runConformanceScenario(scenario, serverUrl);
      process.exit(0);
    } catch (error) {
      logError('[Conformance] Error:', error);
      process.exit(1);
    }
  }

  // Parse CLI args
  let transport;
  const roots: string[] = [];
  let enableSampling = false;
  let approvalMode: 'ask' | 'auto' = 'ask';
  let logLevel: LoggingLevel = 'info';
  let cliInstructions: string | undefined;
  let noServerInstructions = false;
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stdio' && args[i + 1]) {
      const parts = args[i + 1].split(' ');
      transport = createStdioTransport(parts[0], parts.slice(1));
      i++;
    } else if (args[i] === '--url' && args[i + 1]) {
      transport = createHttpTransport(args[i + 1]);
      i++;
    } else if (args[i] === '--roots' && args[i + 1]) {
      roots.push(...args[i + 1].split(','));
      i++;
    } else if (args[i] === '--log-level' && args[i + 1]) {
      const level = args[i + 1];
      if (isValidLoggingLevel(level)) {
        logLevel = level;
      } else {
        logError(`Invalid log level: ${args[i + 1]}`);
        logError(`Valid levels: ${LOGGING_LEVELS.join(', ')}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--sampling') {
      enableSampling = true;
    } else if (args[i] === '--instructions' && args[i + 1]) {
      cliInstructions = args[i + 1];
      i++;
    } else if (args[i] === '--no-server-instructions') {
      noServerInstructions = true;
    } else if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    } else if (args[i] === '--approval-mode' && args[i + 1]) {
      const mode = args[i + 1];
      if (mode === 'ask' || mode === 'auto') {
        approvalMode = mode;
      } else {
        logError(`Invalid approval mode: ${mode}`);
        logError('Valid modes: ask, auto');
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--help') {
      log(`
Usage: mcp-skilljack-client [options]

Connection:
  --stdio "command args"   Connect via stdio
  --url <url>              Connect via HTTP

Capabilities:
  --sampling               Enable sampling (requires ANTHROPIC_API_KEY)
  --approval-mode <mode>   Sampling approval mode (default: ask)
                           ask  = user approves each request (per MCP spec)
                           auto = auto-approve (trusted servers only)
  --roots <paths>          Comma-separated roots to expose
  --log-level <level>      Set logging level (default: info)
                           Levels: ${LOGGING_LEVELS.join(', ')}

Server Instructions:
  --instructions "text"    Add custom instructions for this session
  --no-server-instructions Disable MCP server instructions (selective control)
  --config <path>          Custom config file path (default: ./mcp-client.json)

  Instructions are prepended to the system prompt in sampling requests.
  Sources (in order): MCP server -> config file -> CLI flag

  Config file format (mcp-client.json):
    { "servers": { "server-name": { "instructions": "..." } } }

  SECURITY NOTE: Instructions are probabilistic guidance - do not rely on
  them for security-critical operations. Use deterministic checks instead.

Conformance testing:
  --conformance <scenario> <url>   Run conformance test scenario
                                   Scenarios: initialize, tools-call, elicitation-defaults
`);
      return;
    }
  }

  if (!transport) {
    logError('Error: Specify --stdio or --url');
    process.exit(1);
  }

  // Load client config file
  const config = loadConfig(configPath);

  // Build capabilities based on flags
  const capabilities: Record<string, unknown> = {};
  if (enableSampling) capabilities.sampling = { tools: {} };
  if (roots.length) capabilities.roots = { listChanged: true };
  capabilities.elicitation = { form: {} };
  // Task capabilities - both for calling server tools as tasks AND for executing
  // server-initiated requests (sampling/elicitation) as client-side tasks
  capabilities.tasks = {
    list: {},
    cancel: {},
    requests: {
      sampling: { createMessage: {} },
      elicitation: { create: {} },
    },
  };

  // Create task store for client-side task support
  // This enables the SDK to provide extra.taskStore to request handlers
  const clientTaskStore = new InMemoryTaskStore();

  // Create client with task store
  const client = new Client(
    { name: 'mcp-skilljack-client', version: '0.1.0' },
    { capabilities, taskStore: clientTaskStore }
  );

  // Set up client-side task request handlers (tasks/get, tasks/result, etc.)
  // This allows the server to poll for task status and retrieve results
  setupClientTasks(client, {
    onLog: (msg: string) => log(msg),
  });

  // Set up capabilities that don't need server instructions
  // The SDK provides extra.taskStore to handlers automatically via the taskStore option above
  setupElicitation(client, {
    onLog: (msg: string) => log(msg),
  });

  if (roots.length) {
    setupRoots(client, roots);
  }

  setupLogging(client, (level, logger, data) => {
    log(`[${level}]${logger ? ` ${logger}:` : ''}`, data ?? '');
  });

  // Set up list change notifications - react when server's tools/prompts/resources change
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

  // Set up resource subscription notifications
  setupSubscriptions(client, (uri) => {
    log(`[Subscription] Resource updated: ${uri}`);
  });

  // Connect
  log('Connecting...');
  await client.connect(transport);
  log('Connected!\n');

  // Get server info for instructions lookup
  const serverInfo = client.getServerVersion();
  const serverName = serverInfo?.name ?? 'unknown';

  // Combine instructions from all sources
  const mcpInstructions = noServerInstructions ? undefined : client.getInstructions();
  const configInstructions = getServerInstructions(config, serverName);
  const instructionsResult = combineInstructionsWithSources({
    mcpInstructions,
    configInstructions,
    cliInstructions,
  });

  // Log active instructions for transparency
  logInstructions(instructionsResult);

  // Set up sampling with combined instructions (after connect so we have server info)
  // The SDK provides extra.taskStore to handlers automatically via the taskStore option above
  if (enableSampling) {
    setupSampling(client, {
      apiKey: process.env.ANTHROPIC_API_KEY,
      approvalMode,
      serverInstructions: instructionsResult.combined,

      // CLI callback: display request and prompt for approval
      onApprovalRequest: async (request: SamplingRequest) => {
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

        // Prompt for approval
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        return new Promise((resolve) => {
          rl.question('\nApprove this request? [Y/n]: ', (answer) => {
            rl.close();
            const normalized = answer.trim().toLowerCase();
            resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
          });
        });
      },

      // CLI callback: display LLM response
      onResponse: (response: SamplingResponse) => {
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
      },

      // CLI callback: log status messages
      onLog: (message: string) => {
        log(message);
      },
    });
  }

  // List capabilities and store for later use
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

  // Show completions support
  if (serverSupportsCompletions(client)) {
    log('Completions: supported');
  }

  // Show subscriptions support
  if (serverSupportsSubscriptions(client)) {
    log('Subscriptions: supported');
  }

  // Show tasks support
  if (serverSupportsTasks(client)) {
    log('Tasks: supported');
  }

  // Set logging level if server supports it
  if (serverSupportsLogging(client)) {
    await setLoggingLevel(client, logLevel);
    log(`Logging: level set to "${logLevel}"`);
  }

  log('\nCommands:');
  log('  call <tool> [json]                  - Call a tool (auto-detects task support)');
  log('  read <uri>                          - Read a resource');
  log('  subscribe <uri>                     - Subscribe to resource updates');
  log('  unsubscribe <uri>                   - Unsubscribe from resource updates');
  log('  complete prompt <name> <arg> [val]  - Get prompt completions');
  log('  complete resource <uri> <arg> [val] - Get resource completions');
  log('  pick prompt <name> <arg>            - Interactive prompt completion picker');
  log('  pick resource <uri> <arg>           - Interactive resource completion picker');
  log('  loglevel <level>                    - Change logging level');
  log('  tasks                               - List all active tasks');
  log('  task <id>                           - Get task status');
  log('  cancel <id>                         - Cancel a running task');
  log('  quit                                - Exit\n');

  // Interactive loop
  let rl = createInterface({ input: process.stdin, output: process.stdout });
  const question = (p: string) => new Promise<string>(r => rl.question(p, a => r(a.trim())));

  let running = true;
  while (running) {
    const input = await question('> ');
    const [cmd, ...rest] = input.split(' ');

    try {
      if (cmd === 'call' && rest[0]) {
        const toolName = rest[0];
        const args = rest.slice(1).join(' ');
        const parsedArgs = args ? JSON.parse(args) : {};

        // Check if tool supports tasks
        const tool = toolsList.find(t => t.name === toolName);
        if (tool && shouldUseTaskMode(client, tool)) {
          // Use task-enabled tool call with progress updates
          log(`[Tasks] Tool "${toolName}" supports tasks - using streaming mode`);
          const result = await callToolWithTaskSupport(client, toolName, parsedArgs, {
            onTaskCreated: (task) => {
              log(`[Task] Created: ${task.taskId}`);
            },
            onTaskStatus: (task) => {
              log(`[Task] Status: ${task.status}${task.statusMessage ? ` - ${task.statusMessage}` : ''}`);
            },
          });
          log(JSON.stringify(result, null, 2));
        } else {
          // Regular tool call
          const result = await client.callTool({
            name: toolName,
            arguments: parsedArgs,
          });
          log(JSON.stringify(result, null, 2));
        }
      } else if (cmd === 'read' && rest[0]) {
        const result = await client.readResource({ uri: rest[0] });
        log(JSON.stringify(result, null, 2));
      } else if (cmd === 'subscribe' && rest[0]) {
        if (!serverSupportsSubscriptions(client)) {
          log('Server does not support subscriptions');
        } else {
          await client.subscribeResource({ uri: rest[0] });
          log(`Subscribed to: ${rest[0]}`);
        }
      } else if (cmd === 'unsubscribe' && rest[0]) {
        if (!serverSupportsSubscriptions(client)) {
          log('Server does not support subscriptions');
        } else {
          await client.unsubscribeResource({ uri: rest[0] });
          log(`Unsubscribed from: ${rest[0]}`);
        }
      } else if (cmd === 'complete' && rest[0] && rest[1] && rest[2]) {
        // complete prompt <name> <arg> [value]
        // complete resource <uri> <arg> [value]
        const [type, nameOrUri, argName, ...valueParts] = rest;
        const value = valueParts.join(' ') || '';
        let result;
        if (type === 'prompt') {
          result = await completePromptArgument(client, nameOrUri, argName, value);
        } else if (type === 'resource') {
          result = await completeResourceArgument(client, nameOrUri, argName, value);
        } else {
          log('Usage: complete prompt|resource <name/uri> <arg> [value]');
          continue;
        }
        log('Values:', result.values.length ? result.values.join(', ') : '(none)');
        if (result.hasMore) log(`(${result.total ?? 'more'} total)`);
      } else if (cmd === 'pick' && rest[0] && rest[1] && rest[2]) {
        // pick prompt <name> <arg>
        // pick resource <uri> <arg>
        const [type, nameOrUri, argName] = rest;
        let ref;
        if (type === 'prompt') {
          ref = { type: 'ref/prompt' as const, name: nameOrUri };
        } else if (type === 'resource') {
          ref = { type: 'ref/resource' as const, uri: nameOrUri };
        } else {
          log('Usage: pick prompt|resource <name/uri> <arg>');
          continue;
        }
        rl.close();
        const selected = await pickCompletion(client, ref, argName);
        log(selected ? `Selected: ${selected}` : 'Cancelled');
        // Recreate readline after picker
        rl = createInterface({ input: process.stdin, output: process.stdout });
      } else if (cmd === 'loglevel') {
        if (!rest[0]) {
          log(`Current level: ${logLevel}`);
          log(`Available: ${LOGGING_LEVELS.join(', ')}`);
        } else if (isValidLoggingLevel(rest[0])) {
          if (serverSupportsLogging(client)) {
            logLevel = rest[0];
            await setLoggingLevel(client, logLevel);
            log(`Logging level set to: ${logLevel}`);
          } else {
            log('Server does not support logging');
          }
        } else {
          log(`Invalid level: ${rest[0]}`);
          log(`Available: ${LOGGING_LEVELS.join(', ')}`);
        }
      } else if (cmd === 'tasks') {
        // List all active tasks
        if (!serverSupportsTasks(client)) {
          log('Server does not support tasks');
        } else {
          const result = await listTasks(client);
          if (result.tasks.length === 0) {
            log('No active tasks');
          } else {
            log('Active tasks:');
            for (const task of result.tasks) {
              log(formatTaskStatusLine(task));
            }
            if (result.nextCursor) {
              log(`  (more tasks available, cursor: ${result.nextCursor})`);
            }
          }
        }
      } else if (cmd === 'task' && rest[0]) {
        // Get specific task status
        if (!serverSupportsTasks(client)) {
          log('Server does not support tasks');
        } else {
          const task = await getTask(client, rest[0]);
          log(formatTaskForDisplay(task));
        }
      } else if (cmd === 'cancel' && rest[0]) {
        // Cancel a running task
        if (!serverSupportsTasks(client)) {
          log('Server does not support tasks');
        } else {
          await cancelTask(client, rest[0]);
          log(`Task ${rest[0]} cancelled`);
        }
      } else if (cmd === 'quit' || cmd === 'exit') {
        running = false;
      } else if (cmd) {
        log('Type "quit" to exit. Available commands: call, read, subscribe, unsubscribe, complete, pick, loglevel, tasks, task, cancel');
      }
    } catch (e) {
      logError('Error:', e instanceof Error ? e.message : e);
    }
  }

  rl.close();
  await client.close();
}

main().catch(logError);
