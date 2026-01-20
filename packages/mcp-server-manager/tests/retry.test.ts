import { describe, it, expect, vi } from 'vitest';
import {
  calculateBackoff,
  delay,
  cancellableDelay,
  retry,
  withTimeout,
  createDeferred,
  DEFAULT_BACKOFF_CONFIG,
} from '../src/utils/retry.js';

describe('calculateBackoff', () => {
  it('calculates exponential backoff correctly', () => {
    // With default multiplier of 2 and base of 1000
    const attempt0 = calculateBackoff(0, { baseMs: 1000, maxMs: 30000, jitter: 0 });
    const attempt1 = calculateBackoff(1, { baseMs: 1000, maxMs: 30000, jitter: 0 });
    const attempt2 = calculateBackoff(2, { baseMs: 1000, maxMs: 30000, jitter: 0 });

    expect(attempt0).toBe(1000);
    expect(attempt1).toBe(2000);
    expect(attempt2).toBe(4000);
  });

  it('caps at maximum delay', () => {
    const result = calculateBackoff(10, { baseMs: 1000, maxMs: 5000, jitter: 0 });
    expect(result).toBe(5000);
  });

  it('applies jitter within range', () => {
    // Run multiple times to test jitter
    const results = new Set<number>();
    for (let i = 0; i < 20; i++) {
      results.add(calculateBackoff(0, { baseMs: 1000, maxMs: 30000, jitter: 0.5 }));
    }
    // Should have some variation due to jitter
    expect(results.size).toBeGreaterThan(1);
    // All results should be within jitter range (500-1500 for 1000 base with 0.5 jitter)
    for (const result of results) {
      expect(result).toBeGreaterThanOrEqual(500);
      expect(result).toBeLessThanOrEqual(1500);
    }
  });

  it('uses default config when not specified', () => {
    const result = calculateBackoff(0, { jitter: 0 });
    expect(result).toBe(DEFAULT_BACKOFF_CONFIG.baseMs);
  });
});

describe('delay', () => {
  it('resolves after specified time', async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow for timing variance
  });
});

describe('cancellableDelay', () => {
  it('resolves after specified time', async () => {
    const { promise } = cancellableDelay(50);
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects when cancelled', async () => {
    const { promise, cancel } = cancellableDelay(1000);
    cancel();
    await expect(promise).rejects.toThrow('Delay cancelled');
  });
});

describe('retry', () => {
  it('returns success on first attempt if operation succeeds', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const result = await retry(operation, {
      maxAttempts: 3,
      backoff: { baseMs: 10, maxMs: 100 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe('success');
    }
    expect(result.attempts).toBe(1);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    const result = await retry(operation, {
      maxAttempts: 5,
      backoff: { baseMs: 10, maxMs: 100 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe('success');
    }
    expect(result.attempts).toBe(3);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('fails after max attempts', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('always fails'));

    const result = await retry(operation, {
      maxAttempts: 3,
      backoff: { baseMs: 10, maxMs: 100 },
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('respects isRetryable function', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('not retryable'));

    const result = await retry(operation, {
      maxAttempts: 5,
      backoff: { baseMs: 10, maxMs: 100 },
      isRetryable: () => false,
    });

    expect(result.success).toBe(false);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry callback', async () => {
    const onRetry = vi.fn();
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');

    await retry(operation, {
      maxAttempts: 3,
      backoff: { baseMs: 10, maxMs: 100, jitter: 0 },
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 10);
  });
});

describe('withTimeout', () => {
  it('resolves if promise completes in time', async () => {
    const promise = Promise.resolve('done');
    const result = await withTimeout(promise, 1000);
    expect(result).toBe('done');
  });

  it('rejects if promise takes too long', async () => {
    const promise = delay(1000).then(() => 'done');
    await expect(withTimeout(promise, 50)).rejects.toThrow('timed out');
  });

  it('uses custom timeout error', async () => {
    const promise = delay(1000);
    const customError = new Error('Custom timeout');
    await expect(withTimeout(promise, 50, customError)).rejects.toThrow('Custom timeout');
  });
});

describe('createDeferred', () => {
  it('creates a deferred that can be resolved', async () => {
    const deferred = createDeferred<string>();
    deferred.resolve('resolved value');
    const result = await deferred.promise;
    expect(result).toBe('resolved value');
  });

  it('creates a deferred that can be rejected', async () => {
    const deferred = createDeferred<string>();
    deferred.reject(new Error('rejection reason'));
    await expect(deferred.promise).rejects.toThrow('rejection reason');
  });
});
