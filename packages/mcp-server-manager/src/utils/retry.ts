/**
 * Retry and backoff utilities for the MCP server manager
 */

/**
 * Configuration for exponential backoff
 */
export interface BackoffConfig {
  /** Base delay in milliseconds (default: 1000) */
  baseMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxMs: number;
  /** Multiplier for each attempt (default: 2) */
  multiplier?: number;
  /** Random jitter factor 0-1 (default: 0.1) */
  jitter?: number;
}

/**
 * Default backoff configuration
 */
export const DEFAULT_BACKOFF_CONFIG: Required<BackoffConfig> = {
  baseMs: 1000,
  maxMs: 30000,
  multiplier: 2,
  jitter: 0.1,
};

/**
 * Calculates the delay for a given attempt using exponential backoff
 *
 * @param attempt - The attempt number (0-based)
 * @param config - Backoff configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(attempt: number, config: Partial<BackoffConfig> = {}): number {
  const { baseMs, maxMs, multiplier, jitter } = {
    ...DEFAULT_BACKOFF_CONFIG,
    ...config,
  };

  // Calculate exponential delay
  const exponentialDelay = baseMs * Math.pow(multiplier, attempt);

  // Cap at maximum
  const cappedDelay = Math.min(exponentialDelay, maxMs);

  // Add jitter (random variation)
  const jitterAmount = cappedDelay * jitter * (Math.random() * 2 - 1);
  const finalDelay = Math.max(0, cappedDelay + jitterAmount);

  return Math.round(finalDelay);
}

/**
 * Creates a promise that resolves after the specified delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a cancellable delay
 */
export function cancellableDelay(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout>;
  let rejectFn: (reason?: unknown) => void;

  const promise = new Promise<void>((resolve, reject) => {
    rejectFn = reject;
    timeoutId = setTimeout(resolve, ms);
  });

  const cancel = () => {
    clearTimeout(timeoutId);
    rejectFn(new Error('Delay cancelled'));
  };

  return { promise, cancel };
}

/**
 * Configuration for retry operations
 */
export interface RetryConfig {
  /** Maximum number of attempts */
  maxAttempts: number;
  /** Backoff configuration */
  backoff: BackoffConfig;
  /** Optional function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Optional callback called before each retry */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/**
 * Result of a retry operation
 */
export type RetryResult<T> =
  | { success: true; value: T; attempts: number }
  | { success: false; error: unknown; attempts: number };

/**
 * Executes an operation with retry logic
 *
 * @param operation - The async operation to execute
 * @param config - Retry configuration
 * @returns Result of the operation
 */
export async function retry<T>(
  operation: () => Promise<T>,
  config: RetryConfig
): Promise<RetryResult<T>> {
  const { maxAttempts, backoff, isRetryable = () => true, onRetry } = config;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const value = await operation();
      return { success: true, value, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxAttempts - 1 || !isRetryable(error)) {
        break;
      }

      // Calculate and wait for backoff delay
      const delayMs = calculateBackoff(attempt, backoff);
      onRetry?.(attempt + 1, error, delayMs);
      await delay(delayMs);
    }
  }

  return { success: false, error: lastError, attempts: maxAttempts };
}

/**
 * Creates a timeout wrapper for a promise
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param timeoutError - Optional error to throw on timeout
 * @returns Promise that rejects on timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: Error = new Error(`Operation timed out after ${timeoutMs}ms`)
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(timeoutError);
    }, timeoutMs);

    promise
      .then(value => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Creates a deferred promise that can be resolved/rejected externally
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
