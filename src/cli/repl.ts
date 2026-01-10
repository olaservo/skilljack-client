/**
 * Interactive REPL - Command loop for MCP client CLI
 *
 * This module is standalone. Copy this file to add an interactive REPL to any MCP client.
 *
 * Usage:
 *   import { runRepl } from './cli/repl.js';
 *
 *   await runRepl(client, toolsList, { log, logError });
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createInterface } from 'node:readline';

import {
  serverSupportsCompletions,
  completePromptArgument,
  completeResourceArgument,
  pickCompletion,
} from '../capabilities/completions.js';
import {
  serverSupportsTasks,
  shouldUseTaskMode,
  callToolWithTaskSupport,
  listTasks,
  getTask,
  cancelTask,
  formatTaskForDisplay,
  formatTaskStatusLine,
} from '../capabilities/tasks.js';
import {
  serverSupportsLogging,
  setLoggingLevel,
  isValidLoggingLevel,
  LOGGING_LEVELS,
  type LoggingLevel,
} from '../capabilities/logging.js';
import { serverSupportsSubscriptions } from '../capabilities/subscriptions.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ReplConfig {
  /** Log function for output */
  log: (...args: unknown[]) => void;
  /** Error log function */
  logError: (...args: unknown[]) => void;
  /** Initial logging level */
  logLevel: LoggingLevel;
}

// ============================================================================
// HELP TEXT
// ============================================================================

export function printCommands(log: (...args: unknown[]) => void): void {
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
}

// ============================================================================
// REPL
// ============================================================================

/**
 * Run the interactive REPL.
 *
 * @param client - Connected MCP client
 * @param toolsList - List of available tools
 * @param config - REPL configuration
 */
export async function runRepl(
  client: Client,
  toolsList: Tool[],
  config: ReplConfig
): Promise<void> {
  const { log, logError } = config;
  let logLevel = config.logLevel;

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

        const tool = toolsList.find(t => t.name === toolName);
        if (tool && shouldUseTaskMode(client, tool)) {
          log(`[Tasks] Tool "${toolName}" supports tasks - using streaming mode`);
          const result = await callToolWithTaskSupport(client, toolName, parsedArgs, {
            onTaskCreated: (task) => {
              log(`[Task] Created: ${task.taskId}`);
            },
            onTaskStatusUpdate: (task) => {
              log(`[Task] Status: ${task.status}${task.statusMessage ? ` - ${task.statusMessage}` : ''}`);
            },
          });
          log(JSON.stringify(result, null, 2));
        } else {
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
        if (!serverSupportsTasks(client)) {
          log('Server does not support tasks');
        } else {
          const task = await getTask(client, rest[0]);
          log(formatTaskForDisplay(task));
        }
      } else if (cmd === 'cancel' && rest[0]) {
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
}
