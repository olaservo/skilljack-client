import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  toStateSummary,
  type ServerState,
  type ServerStatus,
} from '../src/types/state.js';

describe('createInitialState', () => {
  it('creates a state with disconnected status', () => {
    const state = createInitialState();

    expect(state.status).toBe('disconnected');
    expect(state.consecutiveHealthCheckFailures).toBe(0);
    expect(state.restartStats.attempts).toBe(0);
    expect(state.statusChangedAt).toBeInstanceOf(Date);
  });

  it('creates a new state each time', () => {
    const state1 = createInitialState();
    const state2 = createInitialState();

    expect(state1).not.toBe(state2);
    expect(state1.statusChangedAt).not.toBe(state2.statusChangedAt);
  });
});

describe('toStateSummary', () => {
  it('converts state to summary', () => {
    const state: ServerState = {
      status: 'connected',
      statusChangedAt: new Date(Date.now() - 5000),
      consecutiveHealthCheckFailures: 0,
      lastHealthCheck: {
        healthy: true,
        latencyMs: 50,
        timestamp: new Date(),
      },
      restartStats: {
        attempts: 2,
        lastAttempt: new Date(),
        lastSuccess: true,
      },
      pid: 12345,
    };

    const summary = toStateSummary('my-server', state);

    expect(summary.name).toBe('my-server');
    expect(summary.status).toBe('connected');
    expect(summary.healthy).toBe(true);
    expect(summary.timeInStatus).toBeGreaterThanOrEqual(5000);
    expect(summary.pid).toBe(12345);
    expect(summary.lastLatencyMs).toBe(50);
    expect(summary.restartAttempts).toBe(2);
  });

  it('shows healthy false for non-connected status', () => {
    const state: ServerState = {
      status: 'unhealthy',
      statusChangedAt: new Date(),
      consecutiveHealthCheckFailures: 3,
      restartStats: { attempts: 0 },
    };

    const summary = toStateSummary('server', state);

    expect(summary.healthy).toBe(false);
  });

  it('includes error message', () => {
    const state: ServerState = {
      status: 'failed',
      statusChangedAt: new Date(),
      consecutiveHealthCheckFailures: 0,
      restartStats: { attempts: 5 },
      error: 'Max restart attempts exceeded',
    };

    const summary = toStateSummary('server', state);

    expect(summary.error).toBe('Max restart attempts exceeded');
  });

  it('handles missing optional fields', () => {
    const state: ServerState = {
      status: 'disconnected',
      statusChangedAt: new Date(),
      consecutiveHealthCheckFailures: 0,
      restartStats: { attempts: 0 },
    };

    const summary = toStateSummary('server', state);

    expect(summary.pid).toBeUndefined();
    expect(summary.lastLatencyMs).toBeUndefined();
    expect(summary.error).toBeUndefined();
  });

  const statuses: ServerStatus[] = [
    'disconnected',
    'connecting',
    'connected',
    'unhealthy',
    'restarting',
    'failed',
    'stopped',
  ];

  it.each(statuses)('correctly identifies healthy=true only for connected status: %s', (status) => {
    const state: ServerState = {
      status,
      statusChangedAt: new Date(),
      consecutiveHealthCheckFailures: 0,
      restartStats: { attempts: 0 },
    };

    const summary = toStateSummary('server', state);

    expect(summary.healthy).toBe(status === 'connected');
  });
});
