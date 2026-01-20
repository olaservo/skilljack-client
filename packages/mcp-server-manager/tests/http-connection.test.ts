import { describe, it, expect } from 'vitest';
import { HttpConnection, createFetchOptions } from '../src/core/http-connection.js';
import type { HttpServerConfig } from '../src/types/config.js';

describe('HttpConnection', () => {
  const validConfig: HttpServerConfig = {
    type: 'http',
    url: 'https://api.example.com/mcp',
    headers: { Authorization: 'Bearer token' },
  };

  describe('validate', () => {
    it('validates a valid URL', () => {
      const conn = new HttpConnection('test', validConfig);
      const result = conn.validate();
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects invalid URL format', () => {
      const config: HttpServerConfig = {
        type: 'http',
        url: 'not-a-valid-url',
      };
      const conn = new HttpConnection('test', config);
      const result = conn.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('rejects non-http protocols', () => {
      const config: HttpServerConfig = {
        type: 'http',
        url: 'ftp://example.com/file',
      };
      const conn = new HttpConnection('test', config);
      const result = conn.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid protocol');
    });

    it('accepts https URLs', () => {
      const config: HttpServerConfig = {
        type: 'http',
        url: 'https://secure.example.com',
      };
      const conn = new HttpConnection('test', config);
      const result = conn.validate();
      expect(result.valid).toBe(true);
    });
  });

  describe('getTransportConfig', () => {
    it('returns the URL and headers', () => {
      const conn = new HttpConnection('test', validConfig);
      const transportConfig = conn.getTransportConfig();

      expect(transportConfig.url).toBe('https://api.example.com/mcp');
      expect(transportConfig.headers).toEqual({ Authorization: 'Bearer token' });
    });
  });

  describe('getUrl', () => {
    it('returns the URL', () => {
      const conn = new HttpConnection('test', validConfig);
      expect(conn.getUrl()).toBe('https://api.example.com/mcp');
    });
  });

  describe('connection state', () => {
    it('starts disconnected', () => {
      const conn = new HttpConnection('test', validConfig);
      expect(conn.isConnected()).toBe(false);
    });

    it('can be marked connected', () => {
      const conn = new HttpConnection('test', validConfig);
      conn.markConnected();
      expect(conn.isConnected()).toBe(true);
    });

    it('can be marked disconnected', () => {
      const conn = new HttpConnection('test', validConfig);
      conn.markConnected();
      conn.markDisconnected();
      expect(conn.isConnected()).toBe(false);
    });
  });
});

describe('createFetchOptions', () => {
  it('creates fetch options with headers', () => {
    const config: HttpServerConfig = {
      type: 'http',
      url: 'https://api.example.com',
      headers: { 'X-Custom': 'value' },
    };

    const options = createFetchOptions(config, 'POST', '{"data": true}');

    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Custom': 'value',
    });
    expect(options.body).toBe('{"data": true}');
  });

  it('works without custom headers', () => {
    const config: HttpServerConfig = {
      type: 'http',
      url: 'https://api.example.com',
    };

    const options = createFetchOptions(config);

    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
    });
  });
});
