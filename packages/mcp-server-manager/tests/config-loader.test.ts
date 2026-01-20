import { describe, it, expect } from 'vitest';
import {
  ConfigLoader,
  createServerConfig,
  createStdioConfig,
  createHttpConfig,
} from '../src/manager/config-loader.js';
import { DEFAULT_LIFECYCLE_CONFIG } from '../src/types/config.js';

describe('ConfigLoader', () => {
  const loader = new ConfigLoader();

  describe('validate', () => {
    it('validates a valid stdio server config', () => {
      const config = {
        servers: [
          {
            name: 'test-server',
            connection: {
              type: 'stdio',
              command: 'node',
              args: ['server.js'],
            },
          },
        ],
      };

      const result = loader.validate(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates a valid http server config', () => {
      const config = {
        servers: [
          {
            name: 'test-server',
            connection: {
              type: 'http',
              url: 'http://localhost:3000',
            },
          },
        ],
      };

      const result = loader.validate(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects missing servers array', () => {
      const config = {};

      const result = loader.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        path: 'servers',
        message: 'Must be an array',
      });
    });

    it('rejects invalid server type', () => {
      const config = {
        servers: ['not an object'],
      };

      const result = loader.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toBe('servers[0]');
    });

    it('rejects missing server name', () => {
      const config = {
        servers: [
          {
            connection: { type: 'stdio', command: 'node' },
          },
        ],
      };

      const result = loader.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        path: 'servers[0].name',
        message: 'Must be a non-empty string',
      });
    });

    it('rejects duplicate server names', () => {
      const config = {
        servers: [
          { name: 'server1', connection: { type: 'stdio', command: 'node' } },
          { name: 'server1', connection: { type: 'stdio', command: 'node' } },
        ],
      };

      const result = loader.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        path: 'servers[1].name',
        message: 'Duplicate server name: server1',
      });
    });

    it('rejects invalid connection type', () => {
      const config = {
        servers: [
          {
            name: 'test',
            connection: { type: 'invalid' },
          },
        ],
      };

      const result = loader.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        path: 'servers[0].connection.type',
        message: 'Must be "stdio" or "http"',
      });
    });

    it('rejects stdio config missing command', () => {
      const config = {
        servers: [
          {
            name: 'test',
            connection: { type: 'stdio' },
          },
        ],
      };

      const result = loader.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        path: 'servers[0].connection.command',
        message: 'Must be a non-empty string',
      });
    });

    it('rejects http config with invalid URL', () => {
      const config = {
        servers: [
          {
            name: 'test',
            connection: { type: 'http', url: 'not-a-url' },
          },
        ],
      };

      const result = loader.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        path: 'servers[0].connection.url',
        message: 'Must be a valid URL',
      });
    });

    it('validates lifecycle config', () => {
      const config = {
        servers: [
          {
            name: 'test',
            connection: { type: 'stdio', command: 'node' },
            lifecycle: {
              healthCheckEnabled: true,
              healthCheckIntervalMs: 30000,
              maxRestartAttempts: 5,
            },
          },
        ],
      };

      const result = loader.validate(config);
      expect(result.valid).toBe(true);
    });

    it('rejects invalid lifecycle config values', () => {
      const config = {
        servers: [
          {
            name: 'test',
            connection: { type: 'stdio', command: 'node' },
            lifecycle: {
              healthCheckEnabled: 'yes', // should be boolean
              healthCheckIntervalMs: -100, // should be non-negative
            },
          },
        ],
      };

      const result = loader.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('loadFromObject', () => {
    it('applies default values', () => {
      const config = loader.loadFromObject({
        servers: [
          {
            name: 'test',
            connection: { type: 'stdio', command: 'node' },
          },
        ],
      });

      expect(config.servers[0].autoStart).toBe(true);
      expect(config.servers[0].lifecycle).toEqual(DEFAULT_LIFECYCLE_CONFIG);
    });

    it('preserves custom lifecycle values', () => {
      const config = loader.loadFromObject({
        servers: [
          {
            name: 'test',
            connection: { type: 'stdio', command: 'node' },
            lifecycle: {
              healthCheckIntervalMs: 60000,
              maxRestartAttempts: 10,
            },
          },
        ],
      });

      expect(config.servers[0].lifecycle?.healthCheckIntervalMs).toBe(60000);
      expect(config.servers[0].lifecycle?.maxRestartAttempts).toBe(10);
      // Default values should still be applied for unspecified fields
      expect(config.servers[0].lifecycle?.healthCheckEnabled).toBe(true);
    });

    it('applies global defaults', () => {
      const config = loader.loadFromObject({
        servers: [
          {
            name: 'test',
            connection: { type: 'stdio', command: 'node' },
          },
        ],
        defaults: {
          healthCheckIntervalMs: 60000,
        },
      });

      expect(config.servers[0].lifecycle?.healthCheckIntervalMs).toBe(60000);
    });

    it('server config overrides global defaults', () => {
      const config = loader.loadFromObject({
        servers: [
          {
            name: 'test',
            connection: { type: 'stdio', command: 'node' },
            lifecycle: {
              healthCheckIntervalMs: 15000,
            },
          },
        ],
        defaults: {
          healthCheckIntervalMs: 60000,
        },
      });

      expect(config.servers[0].lifecycle?.healthCheckIntervalMs).toBe(15000);
    });
  });
});

describe('createServerConfig', () => {
  it('creates a basic server config', () => {
    const config = createServerConfig('test', { type: 'stdio', command: 'node' });

    expect(config.name).toBe('test');
    expect(config.connection.type).toBe('stdio');
  });

  it('includes optional lifecycle config', () => {
    const config = createServerConfig(
      'test',
      { type: 'stdio', command: 'node' },
      { lifecycle: { maxRestartAttempts: 10 } }
    );

    expect(config.lifecycle?.maxRestartAttempts).toBe(10);
  });
});

describe('createStdioConfig', () => {
  it('creates a stdio config with command', () => {
    const config = createStdioConfig('node');
    expect(config.type).toBe('stdio');
    expect(config.command).toBe('node');
  });

  it('includes args', () => {
    const config = createStdioConfig('node', ['server.js', '--port', '3000']);
    expect(config.args).toEqual(['server.js', '--port', '3000']);
  });

  it('includes env and cwd', () => {
    const config = createStdioConfig('node', ['server.js'], {
      env: { NODE_ENV: 'production' },
      cwd: '/app',
    });
    expect(config.env).toEqual({ NODE_ENV: 'production' });
    expect(config.cwd).toBe('/app');
  });
});

describe('createHttpConfig', () => {
  it('creates an http config with url', () => {
    const config = createHttpConfig('http://localhost:3000');
    expect(config.type).toBe('http');
    expect(config.url).toBe('http://localhost:3000');
  });

  it('includes headers', () => {
    const config = createHttpConfig('http://localhost:3000', {
      Authorization: 'Bearer token',
    });
    expect(config.headers).toEqual({ Authorization: 'Bearer token' });
  });
});
