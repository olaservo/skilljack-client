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

/** Maximum task length in characters (100KB) */
const MAX_TASK_LENGTH = 100_000;

/** Allowlist of environment variable names the renderer may set */
const ALLOWED_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'DEEPSEEK_API_KEY',
  'XAI_API_KEY',
]);

export function createPiAdapter(): CodingAgentAdapter {
  let proc: ChildProcess | null = null;
  let rl: readline.Interface | null = null;
  let running = false;
  let procExited = false;
  let bufferedFirstLine: string | null = null;

  function sendCommand(cmd: Record<string, unknown>): void {
    if (!proc?.stdin || !proc.stdin.writable) throw new Error('Pi process not available for commands');
    proc.stdin.write(JSON.stringify(cmd) + '\n');
  }

  return {
    async start(config: CodingAgentConfig) {
      // Hardcode CLI path — ignore any renderer-supplied value to prevent
      // arbitrary command execution from the untrusted renderer context.
      const cliPath = 'pi';
      const args = ['--mode', 'rpc'];
      if (config.provider) args.push('--provider', config.provider);
      if (config.model) args.push('--model', config.model);

      // Filter env vars through allowlist to prevent the renderer from
      // overriding sensitive variables like PATH or LD_PRELOAD.
      const safeEnv: Record<string, string> = {};
      if (config.env) {
        for (const [key, val] of Object.entries(config.env)) {
          if (ALLOWED_ENV_KEYS.has(key)) {
            safeEnv[key] = val;
          }
        }
      }

      // Spawn pi directly (it may be a native binary or a Node shim on PATH)
      proc = spawn(cliPath, args, {
        cwd: config.cwd,
        env: { ...globalThis.process.env, ...safeEnv },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      rl = readline.createInterface({ input: proc.stdout!, terminal: false });

      // Track process exit so execute() can detect a dead process between calls
      procExited = false;
      proc.on('close', () => {
        procExited = true;
      });

      // Collect stderr for diagnostics (capped at 4KB to prevent unbounded growth)
      let stderrBuf = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.length > 4096) {
          stderrBuf = stderrBuf.slice(-4096);
        }
      });

      // Wait for the first stdout line (pi ready signal) or process failure,
      // with a configurable fallback timeout.
      const startTimeout = config.timeout ? Math.min(config.timeout, 30000) : 5000;
      await new Promise<void>((resolve, reject) => {
        const onReady = (line?: string) => {
          // Buffer the first line so execute() can replay it — avoids
          // silently dropping a real event if pi doesn't send a dedicated ready signal.
          if (typeof line === 'string') {
            bufferedFirstLine = line;
          }
          cleanup();
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          reject(new Error(`Failed to start pi: ${err.message}`));
        };
        const onExit = (code: number | null) => {
          if (code !== null && code !== 0) {
            cleanup();
            reject(
              new Error(
                `Pi process exited with code ${code}${stderrBuf ? `: ${stderrBuf.slice(0, 500)}` : ''}`
              )
            );
          }
        };
        const cleanup = () => {
          clearTimeout(timeout);
          rl!.off('line', onReady);
          proc!.off('error', onError);
          proc!.off('exit', onExit);
        };
        // Generous fallback — if pi emits no stdout at all, eventually continue
        const timeout = setTimeout(() => {
          console.warn(`[PiAdapter] pi did not emit a ready signal within ${startTimeout / 1000}s, proceeding optimistically`);
          onReady();
        }, startTimeout);
        rl!.once('line', onReady);
        proc!.on('error', onError);
        proc!.on('exit', onExit);
      });
    },

    async *execute(task: string): AsyncIterable<AgentEvent> {
      if (!proc?.stdin || !rl) throw new Error('Pi process not started');
      if (procExited) throw new Error('Pi process has already exited');
      if (running) throw new Error('Already executing a task');

      if (task.length > MAX_TASK_LENGTH) {
        throw new Error(`Task too long (${task.length} chars, max ${MAX_TASK_LENGTH})`);
      }

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

      // Replay the buffered first line from start() if it was a real event
      if (bufferedFirstLine) {
        onLine(bufferedFirstLine);
        bufferedFirstLine = null;
      }

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
      if (procExited) throw new Error('Pi process has already exited');
      sendCommand({ type: 'steer', message });
    },

    async abort() {
      if (procExited) return; // Silently no-op if already dead
      sendCommand({ type: 'abort' });
      running = false;
    },

    async stop() {
      if (proc) {
        // Only attempt to kill if the process is still alive
        if (proc.exitCode === null && !proc.killed) {
          const p = proc; // Capture reference before async gap
          await new Promise<void>((res) => {
            const onExit = () => {
              clearTimeout(timeout);
              res();
            };
            const timeout = setTimeout(() => {
              p.off('exit', onExit);
              p.kill('SIGKILL');
              res();
            }, 2000);
            p.once('exit', onExit);
            p.kill('SIGTERM');
          });
        }
        proc = null;
        rl = null;
        running = false;
        procExited = false;
        bufferedFirstLine = null;
      }
    },

    isRunning() {
      return running;
    },

    isProcessAlive() {
      return proc !== null && !procExited;
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
  const type = raw.type;
  if (typeof type !== 'string') return [];

  switch (type) {
    case 'message_update': {
      const ame = raw.assistantMessageEvent as Record<string, unknown> | undefined;
      if (!ame) return [];
      const ameType = ame.type as string;
      if (ameType === 'text_delta') {
        const delta = ame.delta;
        if (typeof delta !== 'string' || !delta) return [];
        return [{ type: 'text_delta', delta }];
      }
      if (ameType === 'thinking_delta') {
        const delta = ame.delta;
        if (typeof delta !== 'string' || !delta) return [];
        return [{ type: 'thinking_delta', delta }];
      }
      return [];
    }

    case 'tool_execution_start': {
      const toolCallId = raw.toolCallId;
      const toolName = raw.toolName;
      if (typeof toolCallId !== 'string' || typeof toolName !== 'string') {
        console.warn('[PiAdapter] Malformed tool_execution_start event:', raw);
        return [];
      }
      return [
        {
          type: 'tool_start',
          toolCallId,
          toolName,
          args: (raw.args as Record<string, unknown>) ?? {},
        },
      ];
    }

    case 'tool_execution_update': {
      const toolCallId = raw.toolCallId;
      if (typeof toolCallId !== 'string') {
        console.warn('[PiAdapter] Malformed tool_execution_update event:', raw);
        return [];
      }
      return [
        {
          type: 'tool_update',
          toolCallId,
          partialResult: raw.partialResult,
        },
      ];
    }

    case 'tool_execution_end': {
      const toolCallId = raw.toolCallId;
      const toolName = raw.toolName;
      if (typeof toolCallId !== 'string' || typeof toolName !== 'string') {
        console.warn('[PiAdapter] Malformed tool_execution_end event:', raw);
        return [];
      }
      return [
        {
          type: 'tool_end',
          toolCallId,
          toolName,
          result: raw.result,
          isError: (raw.isError as boolean) ?? false,
        },
      ];
    }

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
