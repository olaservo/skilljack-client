/**
 * Process management for stdio-based MCP servers
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { StdioServerConfig } from '../types/config.js';
import { createLogger, type Logger } from '../utils/logger.js';

/**
 * Events emitted by the process manager
 */
export interface ProcessManagerEvents {
  /** Process started successfully */
  started: (pid: number) => void;
  /** Process exited */
  exited: (code: number | null, signal: string | null) => void;
  /** Process error occurred */
  error: (error: Error) => void;
  /** Data received on stderr */
  stderr: (data: string) => void;
}

/**
 * Manages a single stdio process for an MCP server
 */
export class ProcessManager extends EventEmitter {
  private config: StdioServerConfig;
  private logger: Logger;
  private process: ChildProcess | null = null;
  private shutdownTimeoutMs: number;

  constructor(
    serverName: string,
    config: StdioServerConfig,
    shutdownTimeoutMs: number = 10000,
    logger?: Logger
  ) {
    super();
    this.config = config;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.logger = logger ?? createLogger(`ProcessManager:${serverName}`);
  }

  /**
   * Starts the process
   */
  async start(): Promise<ChildProcess> {
    if (this.process) {
      throw new Error('Process already running');
    }

    this.logger.info('Starting process', {
      command: this.config.command,
      args: this.config.args,
      cwd: this.config.cwd,
    });

    return new Promise((resolve, reject) => {
      try {
        const proc = spawn(this.config.command, this.config.args ?? [], {
          cwd: this.config.cwd,
          env: {
            ...process.env,
            ...this.config.env,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          // Don't detach - we want to manage this process
          detached: false,
          // Use shell on Windows for better command resolution
          shell: process.platform === 'win32',
        });

        this.process = proc;

        // Handle spawn errors
        proc.on('error', (error) => {
          this.logger.error('Process spawn error', { error: error.message });
          this.process = null;
          this.emit('error', error);
          reject(error);
        });

        // Handle process exit
        proc.on('exit', (code, signal) => {
          this.logger.info('Process exited', { code, signal });
          this.process = null;
          this.emit('exited', code, signal);
        });

        // Capture stderr for logging
        proc.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          this.logger.debug('Process stderr', { data: text });
          this.emit('stderr', text);
        });

        // Wait for spawn event to confirm process started
        proc.on('spawn', () => {
          const pid = proc.pid!;
          this.logger.info('Process started', { pid });
          this.emit('started', pid);
          resolve(proc);
        });
      } catch (error) {
        this.logger.error('Failed to spawn process', {
          error: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      }
    });
  }

  /**
   * Stops the process gracefully, with force kill fallback
   */
  async stop(): Promise<void> {
    if (!this.process) {
      this.logger.debug('No process to stop');
      return;
    }

    const proc = this.process;
    const pid = proc.pid;

    this.logger.info('Stopping process', { pid });

    return new Promise((resolve) => {
      let killed = false;

      // Set up force kill timeout
      const forceKillTimeout = setTimeout(() => {
        if (!killed && proc.pid) {
          this.logger.warn('Process did not exit gracefully, force killing', { pid });
          try {
            proc.kill('SIGKILL');
          } catch {
            // Process may have already exited
          }
        }
      }, this.shutdownTimeoutMs);

      // Listen for exit
      const onExit = () => {
        killed = true;
        clearTimeout(forceKillTimeout);
        this.process = null;
        resolve();
      };

      proc.once('exit', onExit);

      // Send graceful termination signal
      try {
        // On Windows, SIGTERM doesn't work well, so we send SIGINT first
        if (process.platform === 'win32') {
          proc.kill('SIGINT');
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        // Process may have already exited
        killed = true;
        clearTimeout(forceKillTimeout);
        this.process = null;
        resolve();
      }
    });
  }

  /**
   * Forces the process to stop immediately
   */
  forceStop(): void {
    if (!this.process) {
      return;
    }

    this.logger.warn('Force stopping process', { pid: this.process.pid });

    try {
      this.process.kill('SIGKILL');
    } catch {
      // Process may have already exited
    }
    this.process = null;
  }

  /**
   * Gets the current process (if running)
   */
  getProcess(): ChildProcess | null {
    return this.process;
  }

  /**
   * Gets the process ID (if running)
   */
  getPid(): number | undefined {
    return this.process?.pid;
  }

  /**
   * Checks if the process is running
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Gets the stdin stream for writing to the process
   */
  getStdin(): NodeJS.WritableStream | null {
    return this.process?.stdin ?? null;
  }

  /**
   * Gets the stdout stream for reading from the process
   */
  getStdout(): NodeJS.ReadableStream | null {
    return this.process?.stdout ?? null;
  }
}
