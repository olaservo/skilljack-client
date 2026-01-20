import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthMonitor, type HealthMonitorCallbacks } from '../src/core/health-monitor.js';
import type { HealthCheckResult } from '../src/types/state.js';

// Mock MCP client
const createMockClient = () => ({
  ping: vi.fn(),
});

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;
  let mockClient: ReturnType<typeof createMockClient>;
  let callbacks: HealthMonitorCallbacks;
  let onHealthCheckResults: HealthCheckResult[];
  let onUnhealthyCalls: Array<{ failures: number; result: HealthCheckResult }>;
  let onRecoveredCalls: HealthCheckResult[];

  beforeEach(() => {
    vi.useFakeTimers();

    mockClient = createMockClient();
    onHealthCheckResults = [];
    onUnhealthyCalls = [];
    onRecoveredCalls = [];

    callbacks = {
      onHealthCheck: (result) => onHealthCheckResults.push(result),
      onUnhealthy: (failures, result) => onUnhealthyCalls.push({ failures, result }),
      onRecovered: (result) => onRecoveredCalls.push(result),
    };

    monitor = new HealthMonitor(
      'test-server',
      {
        intervalMs: 1000,
        timeoutMs: 500,
        unhealthyThreshold: 3,
      },
      callbacks
    );
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  it('initializes with correct state', () => {
    expect(monitor.isRunning()).toBe(false);
    expect(monitor.getConsecutiveFailures()).toBe(0);
  });

  it('does not start without a client', () => {
    monitor.start();
    expect(monitor.isRunning()).toBe(false);
  });

  it('starts with a client', () => {
    monitor.setClient(mockClient as any);
    mockClient.ping.mockResolvedValue({});
    monitor.start();
    expect(monitor.isRunning()).toBe(true);
  });

  it('performs health check on start', async () => {
    monitor.setClient(mockClient as any);
    mockClient.ping.mockResolvedValue({});

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockClient.ping).toHaveBeenCalledTimes(1);
    expect(onHealthCheckResults).toHaveLength(1);
    expect(onHealthCheckResults[0].healthy).toBe(true);
  });

  it('performs periodic health checks', async () => {
    monitor.setClient(mockClient as any);
    mockClient.ping.mockResolvedValue({});

    monitor.start();
    await vi.advanceTimersByTimeAsync(0); // Initial check
    await vi.advanceTimersByTimeAsync(1000); // First interval
    await vi.advanceTimersByTimeAsync(1000); // Second interval

    expect(mockClient.ping).toHaveBeenCalledTimes(3);
    expect(onHealthCheckResults).toHaveLength(3);
  });

  it('tracks consecutive failures', async () => {
    monitor.setClient(mockClient as any);
    mockClient.ping.mockRejectedValue(new Error('Connection failed'));

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(monitor.getConsecutiveFailures()).toBe(1);
    expect(onHealthCheckResults[0].healthy).toBe(false);
    expect(onHealthCheckResults[0].error).toBe('Connection failed');
  });

  it('triggers onUnhealthy after threshold', async () => {
    monitor.setClient(mockClient as any);
    mockClient.ping.mockRejectedValue(new Error('Connection failed'));

    monitor.start();
    await vi.advanceTimersByTimeAsync(0); // Failure 1
    await vi.advanceTimersByTimeAsync(1000); // Failure 2
    await vi.advanceTimersByTimeAsync(1000); // Failure 3

    expect(monitor.getConsecutiveFailures()).toBe(3);
    expect(onUnhealthyCalls).toHaveLength(1);
    expect(onUnhealthyCalls[0].failures).toBe(3);
  });

  it('does not trigger onUnhealthy multiple times', async () => {
    monitor.setClient(mockClient as any);
    mockClient.ping.mockRejectedValue(new Error('Connection failed'));

    monitor.start();
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    // Should only be called once when threshold is first crossed
    expect(onUnhealthyCalls).toHaveLength(1);
  });

  it('resets failure count on success', async () => {
    monitor.setClient(mockClient as any);
    mockClient.ping
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValue({});

    monitor.start();
    await vi.advanceTimersByTimeAsync(0); // Failure 1
    await vi.advanceTimersByTimeAsync(1000); // Failure 2

    expect(monitor.getConsecutiveFailures()).toBe(2);

    await vi.advanceTimersByTimeAsync(1000); // Success

    expect(monitor.getConsecutiveFailures()).toBe(0);
  });

  it('triggers onRecovered after unhealthy', async () => {
    monitor.setClient(mockClient as any);
    mockClient.ping
      .mockRejectedValueOnce(new Error('Fail'))
      .mockRejectedValueOnce(new Error('Fail'))
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValue({});

    monitor.start();
    await vi.advanceTimersByTimeAsync(0); // Failure 1
    await vi.advanceTimersByTimeAsync(1000); // Failure 2
    await vi.advanceTimersByTimeAsync(1000); // Failure 3 - becomes unhealthy
    await vi.advanceTimersByTimeAsync(1000); // Success - recovers

    expect(onUnhealthyCalls).toHaveLength(1);
    expect(onRecoveredCalls).toHaveLength(1);
    expect(onRecoveredCalls[0].healthy).toBe(true);
  });

  it('stops monitoring', async () => {
    monitor.setClient(mockClient as any);
    mockClient.ping.mockResolvedValue({});

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);

    monitor.stop();
    expect(monitor.isRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockClient.ping).toHaveBeenCalledTimes(1); // No additional calls
  });

  it('resets failure count manually', async () => {
    monitor.setClient(mockClient as any);
    mockClient.ping.mockRejectedValue(new Error('Fail'));

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(monitor.getConsecutiveFailures()).toBe(2);

    monitor.resetFailureCount();

    expect(monitor.getConsecutiveFailures()).toBe(0);
  });

  describe('checkNow', () => {
    it('performs immediate health check', async () => {
      monitor.setClient(mockClient as any);
      mockClient.ping.mockResolvedValue({});

      const result = await monitor.checkNow();

      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy result on failure', async () => {
      monitor.setClient(mockClient as any);
      mockClient.ping.mockRejectedValue(new Error('Failed'));

      const result = await monitor.checkNow();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Failed');
    });

    it('returns error when no client', async () => {
      const result = await monitor.checkNow();

      expect(result.healthy).toBe(false);
      expect(result.error).toBe('No client available');
    });
  });
});
