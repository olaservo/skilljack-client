/**
 * Pluggable logger interface for the MCP server manager
 */

/**
 * Log levels supported by the logger
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface that can be implemented by any logging system
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Creates a child logger with a prefix
 */
export interface LoggerFactory {
  createLogger(prefix: string): Logger;
}

/**
 * Console-based logger implementation
 */
export class ConsoleLogger implements Logger {
  private prefix: string;
  private minLevel: LogLevel;

  private static readonly levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(prefix: string = '', minLevel: LogLevel = 'info') {
    this.prefix = prefix;
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return ConsoleLogger.levels[level] >= ConsoleLogger.levels[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const prefixStr = this.prefix ? `[${this.prefix}] ` : '';
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `${timestamp} ${level.toUpperCase().padEnd(5)} ${prefixStr}${message}${contextStr}`;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, context));
    }
  }
}

/**
 * Console logger factory
 */
export class ConsoleLoggerFactory implements LoggerFactory {
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  createLogger(prefix: string): Logger {
    return new ConsoleLogger(prefix, this.minLevel);
  }
}

/**
 * No-op logger that discards all messages
 */
export class NoopLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

/**
 * No-op logger factory
 */
export class NoopLoggerFactory implements LoggerFactory {
  createLogger(): Logger {
    return new NoopLogger();
  }
}

/**
 * Default logger factory instance
 */
let defaultLoggerFactory: LoggerFactory = new ConsoleLoggerFactory();

/**
 * Sets the default logger factory
 */
export function setDefaultLoggerFactory(factory: LoggerFactory): void {
  defaultLoggerFactory = factory;
}

/**
 * Gets the default logger factory
 */
export function getDefaultLoggerFactory(): LoggerFactory {
  return defaultLoggerFactory;
}

/**
 * Creates a logger using the default factory
 */
export function createLogger(prefix: string): Logger {
  return defaultLoggerFactory.createLogger(prefix);
}
