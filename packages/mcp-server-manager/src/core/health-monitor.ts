/**
 * Health monitoring for MCP servers using ping-based checks
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { HealthCheckResult } from '../types/state.js';
import { withTimeout } from '../utils/retry.js';
import { createLogger, type Logger } from '../utils/logger.js';

/**
 * Configuration for health monitoring
 */
export interface HealthMonitorConfig {
  /** Interval between health checks in milliseconds */
  intervalMs: number;
  /** Timeout for individual health check in milliseconds */
  timeoutMs: number;
  /** Number of consecutive failures before marking unhealthy */
  unhealthyThreshold: number;
}

/**
 * Callbacks for health status changes
 */
export interface HealthMonitorCallbacks {
  /** Called when a health check completes */
  onHealthCheck: (result: HealthCheckResult) => void;
  /** Called when server becomes unhealthy */
  onUnhealthy: (consecutiveFailures: number, lastResult: HealthCheckResult) => void;
  /** Called when server recovers from unhealthy state */
  onRecovered: (result: HealthCheckResult) => void;
}

/**
 * Health monitor for a single MCP server
 */
export class HealthMonitor {
  private config: HealthMonitorConfig;
  private callbacks: HealthMonitorCallbacks;
  private logger: Logger;

  private client: Client | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private wasUnhealthy = false;
  private running = false;

  constructor(
    serverName: string,
    config: HealthMonitorConfig,
    callbacks: HealthMonitorCallbacks,
    logger?: Logger
  ) {
    this.config = config;
    this.callbacks = callbacks;
    this.logger = logger ?? createLogger(`HealthMonitor:${serverName}`);
  }

  /**
   * Sets the MCP client to use for health checks
   */
  setClient(client: Client | null): void {
    this.client = client;
  }

  /**
   * Starts periodic health monitoring
   */
  start(): void {
    if (this.running) {
      this.logger.warn('Health monitor already running');
      return;
    }

    if (!this.client) {
      this.logger.warn('No client set, cannot start health monitoring');
      return;
    }

    this.running = true;
    this.consecutiveFailures = 0;
    this.wasUnhealthy = false;

    this.logger.info('Starting health monitoring', {
      intervalMs: this.config.intervalMs,
      timeoutMs: this.config.timeoutMs,
    });

    // Run first check immediately
    void this.runHealthCheck();

    // Set up periodic checks
    this.intervalId = setInterval(() => {
      void this.runHealthCheck();
    }, this.config.intervalMs);
  }

  /**
   * Stops health monitoring
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.logger.info('Health monitoring stopped');
  }

  /**
   * Resets the failure count (e.g., after a successful restart)
   */
  resetFailureCount(): void {
    this.consecutiveFailures = 0;
    this.wasUnhealthy = false;
  }

  /**
   * Gets the current consecutive failure count
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Checks if the monitor is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Runs a single health check
   */
  private async runHealthCheck(): Promise<void> {
    if (!this.client || !this.running) {
      return;
    }

    const startTime = Date.now();
    let result: HealthCheckResult;

    try {
      // Use the MCP ping method with timeout
      await withTimeout(
        this.client.ping(),
        this.config.timeoutMs,
        new Error(`Health check timed out after ${this.config.timeoutMs}ms`)
      );

      const latencyMs = Date.now() - startTime;
      result = {
        healthy: true,
        latencyMs,
        timestamp: new Date(),
      };

      this.consecutiveFailures = 0;
      this.logger.debug('Health check passed', { latencyMs });

      // Check if we recovered from unhealthy state
      if (this.wasUnhealthy) {
        this.wasUnhealthy = false;
        this.callbacks.onRecovered(result);
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      result = {
        healthy: false,
        latencyMs,
        error: errorMessage,
        timestamp: new Date(),
      };

      this.consecutiveFailures++;
      this.logger.warn('Health check failed', {
        error: errorMessage,
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.config.unhealthyThreshold,
      });

      // Check if we've crossed the unhealthy threshold
      if (this.consecutiveFailures >= this.config.unhealthyThreshold && !this.wasUnhealthy) {
        this.wasUnhealthy = true;
        this.callbacks.onUnhealthy(this.consecutiveFailures, result);
      }
    }

    this.callbacks.onHealthCheck(result);
  }

  /**
   * Manually triggers an immediate health check
   */
  async checkNow(): Promise<HealthCheckResult> {
    if (!this.client) {
      return {
        healthy: false,
        latencyMs: 0,
        error: 'No client available',
        timestamp: new Date(),
      };
    }

    const startTime = Date.now();

    try {
      await withTimeout(
        this.client.ping(),
        this.config.timeoutMs,
        new Error(`Health check timed out after ${this.config.timeoutMs}ms`)
      );

      return {
        healthy: true,
        latencyMs: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }
}
