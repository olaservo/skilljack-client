import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConsoleLogger,
  ConsoleLoggerFactory,
  NoopLogger,
  NoopLoggerFactory,
  setDefaultLoggerFactory,
  getDefaultLoggerFactory,
  createLogger,
} from '../src/utils/logger.js';

describe('ConsoleLogger', () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs messages with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix', 'debug');
    logger.info('test message');

    expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    const message = consoleSpy.info.mock.calls[0][0];
    expect(message).toContain('[TestPrefix]');
    expect(message).toContain('test message');
  });

  it('includes context in log output', () => {
    const logger = new ConsoleLogger('', 'debug');
    logger.info('test message', { key: 'value' });

    const message = consoleSpy.info.mock.calls[0][0];
    expect(message).toContain('{"key":"value"}');
  });

  it('respects minimum log level', () => {
    const logger = new ConsoleLogger('', 'warn');

    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');

    expect(consoleSpy.debug).not.toHaveBeenCalled();
    expect(consoleSpy.info).not.toHaveBeenCalled();
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
  });

  it('logs all levels when minLevel is debug', () => {
    const logger = new ConsoleLogger('', 'debug');

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
    expect(consoleSpy.info).toHaveBeenCalledTimes(1);
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
  });
});

describe('ConsoleLoggerFactory', () => {
  it('creates loggers with specified prefix', () => {
    const factory = new ConsoleLoggerFactory('debug');
    const logger = factory.createLogger('MyComponent');

    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('test');

    expect(spy.mock.calls[0][0]).toContain('[MyComponent]');
    spy.mockRestore();
  });

  it('creates loggers with specified min level', () => {
    const factory = new ConsoleLoggerFactory('error');
    const logger = factory.createLogger('Test');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.info('info');
    logger.error('error');

    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('NoopLogger', () => {
  it('does not log anything', () => {
    const logger = new NoopLogger();
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});

    logger.debug('test');
    logger.info('test');
    logger.warn('test');
    logger.error('test');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('NoopLoggerFactory', () => {
  it('creates noop loggers', () => {
    const factory = new NoopLoggerFactory();
    const logger = factory.createLogger('Test');

    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('test');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('default logger factory', () => {
  afterEach(() => {
    // Reset to console logger factory
    setDefaultLoggerFactory(new ConsoleLoggerFactory());
  });

  it('can be set and retrieved', () => {
    const factory = new NoopLoggerFactory();
    setDefaultLoggerFactory(factory);
    expect(getDefaultLoggerFactory()).toBe(factory);
  });

  it('createLogger uses default factory', () => {
    const factory = new NoopLoggerFactory();
    setDefaultLoggerFactory(factory);

    const logger = createLogger('Test');
    expect(logger).toBeInstanceOf(NoopLogger);
  });
});
