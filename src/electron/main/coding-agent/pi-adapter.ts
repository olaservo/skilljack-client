/**
 * Pi Coding Agent Adapter
 *
 * Spawns the pi CLI as a subprocess in RPC mode (--mode rpc)
 * and communicates via JSONL over stdin/stdout.
 *
 * Event translation maps pi's native event shapes to the
 * normalized AgentEvent type used by the rest of the app.
 */

import { ChildProcess, spawn } from 'node:child_process';
import * as readline from 'node:readline';
import type {
  CodingAgentAdapter,
  CodingAgentConfig,
  AgentEvent,
  ExtensionUIResponse,
} from './adapter.js';

export function createPiAdapter(): CodingAgentAdapter {
  let proc: ChildProcess | null = null;
  let rl: readline.Interface | null = null;
  let running = false;

  function sendCommand(cmd: Record<string, unknown>): void {
    if (!proc?.stdin) throw new Error('Pi process not started');
    proc.stdin.write(JSON.stringify(cmd) + '\n');
  }

  return {
    async start(config: CodingAgentConfig) {
      const cliPath = config.cliPath ?? 'pi';
      const args = ['--mode', 'rpc'];
      if (config.provider) args.push('--provider', config.provider);
      if (config.model) args.push('--model', config.model);
      if (config.args) args.push(...config.args);

      proc = spawn('node', [cliPath, ...args], {
        cwd: config.cwd,
        env: { ...globalThis.process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      rl = readline.createInterface({ input: proc.stdout!, terminal: false });

      // Collect stderr for diagnostics
      let stderrBuf = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });

      // Wait for process to be ready (or fail immediately)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(), 500);
        proc!.on('error', (err) => {
          clearTimeout(timeout);
          reject(new Error(`Failed to start pi: ${err.message}`));
        });
        proc!.on('exit', (code) => {
          if (code !== null && code !== 0) {
            clearTimeout(timeout);
            reject(
              new Error(
                `Pi process exited with code ${code}${stderrBuf ? `: ${stderrBuf.slice(0, 500)}` : ''}`
              )
            );
          }
        });
      });
    },

    async *execute(task: string): AsyncIterable<AgentEvent> {
      if (!proc?.stdin || !rl) throw new Error('Pi process not started');
      running = true;

      // Event queue with async signaling
      const queue: AgentEvent[] = [];
      let resolve: (() => void) | null = null;
      let done = false;

      const onLine = (line: string) => {
        try {
          const data = JSON.parse(line);
          const events = translatePiEvent(data);
          for (const event of events) {
            queue.push(event);
            if (event.type === 'complete' || event.type === 'error') {
              done = true;
              running = false;
            }
          }
          resolve?.();
        } catch {
          // Ignore non-JSON lines (stderr leaks, blank lines, etc.)
        }
      };

      const onClose = () => {
        if (!done) {
          queue.push({ type: 'error', message: 'Pi process exited unexpectedly' });
          done = true;
          running = false;
          resolve?.();
        }
      };

      rl.on('line', onLine);
      proc.on('close', onClose);

      // Send prompt command
      sendCommand({ id: `exec_${Date.now()}`, type: 'prompt', message: task });

      try {
        while (!done) {
          if (queue.length > 0) {
            yield queue.shift()!;
          } else {
            await new Promise<void>((r) => {
              resolve = r;
            });
            resolve = null;
          }
        }
        // Drain remaining events
        while (queue.length > 0) {
          yield queue.shift()!;
        }
      } finally {
        rl.off('line', onLine);
        proc.off('close', onClose);
      }
    },

    async steer(message: string) {
      sendCommand({ type: 'steer', message });
    },

    async abort() {
      sendCommand({ type: 'abort' });
      running = false;
    },

    async stop() {
      if (proc) {
        proc.kill('SIGTERM');
        await new Promise<void>((res) => {
          const timeout = setTimeout(() => {
            proc?.kill('SIGKILL');
            res();
          }, 2000);
          proc?.on('exit', () => {
            clearTimeout(timeout);
            res();
          });
        });
        proc = null;
        rl = null;
        running = false;
      }
    },

    isRunning() {
      return running;
    },

    async respondToUIRequest(response: ExtensionUIResponse) {
      sendCommand(response);
    },
  };
}

// ============================================
// Event Translation
// ============================================

/**
 * Translate a raw pi RPC event into normalized AgentEvent(s).
 *
 * Pi event types (from rpc-types.ts):
 * - message_update (with assistantMessageEvent: text_delta | thinking_delta | ...)
 * - tool_execution_start/update/end
 * - auto_compaction_start/end
 * - auto_retry_start/end
 * - agent_end
 * - extension_ui_request (select, confirm, input, editor, notify, setStatus, setWidget, setTitle, set_editor_text)
 * - extension_error
 */
function translatePiEvent(raw: Record<string, unknown>): AgentEvent[] {
  const type = raw.type as string;

  switch (type) {
    case 'message_update': {
      const ame = raw.assistantMessageEvent as Record<string, unknown> | undefined;
      if (!ame) return [];
      const ameType = ame.type as string;
      if (ameType === 'text_delta') {
        return [{ type: 'text_delta', delta: ame.delta as string }];
      }
      if (ameType === 'thinking_delta') {
        return [{ type: 'thinking_delta', delta: ame.delta as string }];
      }
      return [];
    }

    case 'tool_execution_start':
      return [
        {
          type: 'tool_start',
          toolCallId: raw.toolCallId as string,
          toolName: raw.toolName as string,
          args: (raw.args as Record<string, unknown>) ?? {},
        },
      ];

    case 'tool_execution_update':
      return [
        {
          type: 'tool_update',
          toolCallId: raw.toolCallId as string,
          partialResult: raw.partialResult,
        },
      ];

    case 'tool_execution_end':
      return [
        {
          type: 'tool_end',
          toolCallId: raw.toolCallId as string,
          toolName: raw.toolName as string,
          result: raw.result,
          isError: (raw.isError as boolean) ?? false,
        },
      ];

    case 'auto_compaction_start': {
      const reason = raw.reason as string;
      const msg =
        reason === 'overflow'
          ? 'Context overflow \u2014 compacting...'
          : 'Compacting context...';
      return [{ type: 'status', message: msg, detail: { reason } }];
    }

    case 'auto_compaction_end': {
      const aborted = raw.aborted as boolean;
      const willRetry = raw.willRetry as boolean;
      const errorMessage = raw.errorMessage as string | undefined;

      let msg: string;
      if (aborted && willRetry) {
        msg = 'Compaction interrupted, retrying...';
      } else if (aborted || errorMessage) {
        msg = errorMessage ? `Compaction failed: ${errorMessage}` : 'Compaction failed';
      } else {
        msg = 'Context compacted';
      }
      return [{ type: 'status', message: msg, detail: { aborted, willRetry, errorMessage } }];
    }

    case 'auto_retry_start': {
      const attempt = raw.attempt as number;
      const maxAttempts = raw.maxAttempts as number;
      const delayMs = raw.delayMs as number;
      const errorMessage = raw.errorMessage as string;
      const delaySec = Math.round(delayMs / 1000);
      const msg = `Retrying (${attempt}/${maxAttempts}) in ${delaySec}s: ${errorMessage}`;
      return [{ type: 'status', message: msg, detail: { attempt, maxAttempts, delayMs, errorMessage } }];
    }

    case 'auto_retry_end': {
      const success = raw.success as boolean;
      const attempt = raw.attempt as number;
      const finalError = raw.finalError as string | undefined;
      if (!success && finalError) {
        return [{ type: 'status', message: `Retry failed after ${attempt} attempts: ${finalError}` }];
      }
      // On success, no status needed — normal events resume
      return [];
    }

    case 'agent_end': {
      const usage = raw.usage as Record<string, unknown> | undefined;
      return [
        {
          type: 'complete',
          usage: usage
            ? {
                inputTokens: (usage.inputTokens as number) ?? 0,
                outputTokens: (usage.outputTokens as number) ?? 0,
                totalCost: (usage.totalCost as number) ?? 0,
              }
            : undefined,
        },
      ];
    }

    case 'extension_ui_request': {
      const method = raw.method as string;

      // Map new extension methods to dedicated event types
      if (method === 'setStatus') {
        return [
          {
            type: 'set_status',
            statusKey: raw.statusKey as string,
            statusText: raw.statusText as string | undefined,
          },
        ];
      }
      if (method === 'setWidget') {
        return [
          {
            type: 'set_widget',
            widgetKey: raw.widgetKey as string,
            widgetLines: raw.widgetLines as string[] | undefined,
            widgetPlacement: raw.widgetPlacement as string | undefined,
          },
        ];
      }
      if (method === 'setTitle') {
        return [{ type: 'set_title', title: raw.title as string }];
      }
      if (method === 'set_editor_text') {
        // Treat as a text update for now
        return [];
      }
      if (method === 'notify') {
        const msg = raw.message as string;
        return [{ type: 'status', message: msg }];
      }

      // Interactive methods (select, confirm, input, editor) require host response
      return [
        {
          type: 'ui_request',
          id: raw.id as string,
          method,
          ...(raw as Record<string, unknown>),
        },
      ];
    }

    case 'extension_error': {
      const extPath = raw.extensionPath as string;
      const event = raw.event as string;
      const error = raw.error as string;
      return [
        { type: 'status', message: `Extension error (${extPath}/${event}): ${error}` },
      ];
    }

    default:
      return [];
  }
}
