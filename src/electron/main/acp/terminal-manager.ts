/**
 * ACP Terminal Manager
 *
 * Implements the terminal/* client methods: create (non-blocking spawn),
 * output (rolling byte-limited buffer), wait_for_exit, kill (terminal
 * stays valid), release (kill + free). Ported/simplified from
 * .inbox/acpx/src/acp/terminal-manager.ts.
 *
 * Tree-kill strategy: Windows uses `taskkill /t`; POSIX spawns shell-
 * wrapped commands detached and signals the process group.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import log from 'electron-log';
import { resolveWindowsCommand } from './agent-spawner.js';
import type { AcpTerminalOutputResult } from '../../../shared/acp-types.js';

const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024;
const KILL_GRACE_MS = 1500;

interface ManagedTerminal {
  process: ChildProcess;
  /** Shell-wrapped commands run detached on POSIX so we can signal the group */
  killProcessGroup: boolean;
  output: Buffer;
  truncated: boolean;
  outputByteLimit: number;
  exitCode: number | null | undefined;
  signal: string | null | undefined;
  exitPromise: Promise<{ exitCode: number | null; signal: string | null }>;
}

export interface CreateTerminalParams {
  command: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  /** Resolved by the caller (falls back to the session cwd) */
  cwd: string;
  outputByteLimit?: number | null;
}

/** Trim a buffer to `limit` bytes from the end, keeping UTF-8 boundaries intact. */
function trimToUtf8Boundary(buffer: Buffer, limit: number): Buffer {
  if (limit <= 0) return Buffer.alloc(0);
  if (buffer.length <= limit) return buffer;
  let start = buffer.length - limit;
  while (start < buffer.length && (buffer[start] & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  if (start >= buffer.length) start = buffer.length - limit;
  return buffer.subarray(start);
}

function hasShellSyntax(command: string): boolean {
  return /[|&;<>()$`*?[\]{}'"\\\r\n]/.test(command) || /\s/.test(command);
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();

  async createTerminal(params: CreateTerminalParams): Promise<{ terminalId: string }> {
    const cwd = params.cwd;
    const env = { ...process.env };
    for (const entry of params.env ?? []) {
      env[entry.name] = entry.value;
    }

    const proc = await this.spawnTerminalProcess(params, cwd, env);

    const terminal: ManagedTerminal = {
      process: proc.child,
      killProcessGroup: proc.killProcessGroup,
      output: Buffer.alloc(0),
      truncated: false,
      outputByteLimit: Math.max(
        0,
        Math.round(params.outputByteLimit ?? DEFAULT_OUTPUT_LIMIT_BYTES)
      ),
      exitCode: undefined,
      signal: undefined,
      exitPromise: Promise.resolve({ exitCode: null, signal: null }),
    };

    terminal.exitPromise = new Promise((resolve) => {
      proc.child.once('exit', (exitCode, signal) => {
        terminal.exitCode = exitCode;
        terminal.signal = signal;
        resolve({ exitCode: exitCode ?? null, signal: signal ?? null });
      });
    });

    const appendOutput = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytes.length === 0) return;
      terminal.output = Buffer.concat([terminal.output, bytes]);
      if (terminal.output.length > terminal.outputByteLimit) {
        terminal.output = trimToUtf8Boundary(terminal.output, terminal.outputByteLimit);
        terminal.truncated = true;
      }
    };
    proc.child.stdout?.on('data', appendOutput);
    proc.child.stderr?.on('data', appendOutput);

    const terminalId = randomUUID();
    this.terminals.set(terminalId, terminal);
    log.info(`[ACP] terminal/create ${terminalId}: ${params.command} ${(params.args ?? []).join(' ')}`);
    return { terminalId };
  }

  getOutput(terminalId: string): AcpTerminalOutputResult {
    const terminal = this.requireTerminal(terminalId);
    const hasExit = terminal.exitCode !== undefined || terminal.signal !== undefined;
    return {
      output: terminal.output.toString('utf8'),
      truncated: terminal.truncated,
      exitStatus: hasExit
        ? { exitCode: terminal.exitCode ?? null, signal: terminal.signal ?? null }
        : undefined,
    };
  }

  async waitForExit(terminalId: string): Promise<{ exitCode: number | null; signal: string | null }> {
    return this.requireTerminal(terminalId).exitPromise;
  }

  async kill(terminalId: string): Promise<void> {
    const terminal = this.requireTerminal(terminalId);
    await this.killProcess(terminal);
  }

  async release(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return; // already released
    await this.killProcess(terminal);
    this.terminals.delete(terminalId);
  }

  async shutdown(): Promise<void> {
    for (const terminalId of [...this.terminals.keys()]) {
      await this.release(terminalId).catch(() => {});
    }
  }

  private requireTerminal(terminalId: string): ManagedTerminal {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Unknown terminal: ${terminalId}`);
    }
    return terminal;
  }

  private async spawnTerminalProcess(
    params: CreateTerminalParams,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): Promise<{ child: ChildProcess; killProcessGroup: boolean }> {
    const isWin = process.platform === 'win32';

    // Agents without args may send a full shell command line; wrap it in a shell.
    const needsShell =
      (params.args === undefined || params.args.length === 0) && hasShellSyntax(params.command);

    let command = params.command;
    let args = params.args ?? [];
    let killProcessGroup = false;

    if (needsShell) {
      if (isWin) {
        command = 'cmd.exe';
        args = ['/d', '/s', '/c', params.command];
      } else {
        command = '/bin/sh';
        args = ['-c', params.command];
      }
      killProcessGroup = true;
    } else if (isWin) {
      // Resolve .cmd shims (npm, npx, ...) which need a shell on Windows
      const resolved = resolveWindowsCommand(params.command, env);
      if (resolved && /\.(cmd|bat)$/i.test(resolved)) {
        command = 'cmd.exe';
        args = ['/d', '/s', '/c', [params.command, ...(params.args ?? [])].join(' ')];
        killProcessGroup = true;
      } else if (resolved) {
        command = resolved;
      }
    }

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !isWin && killProcessGroup,
    });

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', reject);
    });

    return { child, killProcessGroup };
  }

  private isRunning(terminal: ManagedTerminal): boolean {
    return terminal.exitCode === undefined && terminal.signal === undefined;
  }

  private async killProcess(terminal: ManagedTerminal): Promise<void> {
    if (!this.isRunning(terminal)) return;
    const pid = terminal.process.pid;
    if (pid === undefined) return;

    if (process.platform === 'win32') {
      await this.taskkill(pid, false);
      const exited = await this.waitForExitOrTimeout(terminal, KILL_GRACE_MS);
      if (!exited) {
        await this.taskkill(pid, true);
      }
      return;
    }

    const target = terminal.killProcessGroup ? -pid : pid;
    try {
      process.kill(target, 'SIGTERM');
    } catch {
      return;
    }
    const exited = await this.waitForExitOrTimeout(terminal, KILL_GRACE_MS);
    if (!exited) {
      try {
        process.kill(target, 'SIGKILL');
      } catch {
        // process exited between signals
      }
    }
  }

  private taskkill(pid: number, force: boolean): Promise<void> {
    const args = ['/pid', String(pid), '/t'];
    if (force) args.push('/f');
    return new Promise((resolve) => {
      const child = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
      child.once('error', () => resolve());
      child.once('close', () => resolve());
    });
  }

  private waitForExitOrTimeout(terminal: ManagedTerminal, ms: number): Promise<boolean> {
    return Promise.race([
      terminal.exitPromise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
    ]);
  }
}
