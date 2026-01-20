/**
 * HTTP connection management for MCP servers
 */

import type { HttpServerConfig } from '../types/config.js';
import { createLogger, type Logger } from '../utils/logger.js';

/**
 * HTTP transport configuration for MCP client
 */
export interface HttpTransportConfig {
  /** The URL to connect to */
  url: string;
  /** Optional headers to include with requests */
  headers?: Record<string, string>;
}

/**
 * Manages HTTP connections for MCP servers
 *
 * Note: This class provides the configuration needed for the MCP SDK's
 * StreamableHTTPClientTransport. The actual transport creation is handled
 * by the SDK.
 */
export class HttpConnection {
  private config: HttpServerConfig;
  private logger: Logger;
  private connected = false;

  constructor(serverName: string, config: HttpServerConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger ?? createLogger(`HttpConnection:${serverName}`);
  }

  /**
   * Gets the transport configuration for the MCP SDK
   */
  getTransportConfig(): HttpTransportConfig {
    return {
      url: this.config.url,
      headers: this.config.headers,
    };
  }

  /**
   * Gets the URL for this connection
   */
  getUrl(): string {
    return this.config.url;
  }

  /**
   * Marks the connection as established
   */
  markConnected(): void {
    this.connected = true;
    this.logger.info('HTTP connection established', { url: this.config.url });
  }

  /**
   * Marks the connection as disconnected
   */
  markDisconnected(): void {
    this.connected = false;
    this.logger.info('HTTP connection closed', { url: this.config.url });
  }

  /**
   * Checks if the connection is marked as connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Validates the HTTP configuration
   */
  validate(): { valid: boolean; error?: string } {
    try {
      const url = new URL(this.config.url);

      // Check for valid protocol
      if (!['http:', 'https:'].includes(url.protocol)) {
        return {
          valid: false,
          error: `Invalid protocol: ${url.protocol}. Must be http: or https:`,
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Invalid URL: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Performs a basic connectivity check (HTTP HEAD request)
   */
  async checkConnectivity(): Promise<{ reachable: boolean; error?: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(this.config.url, {
        method: 'HEAD',
        headers: this.config.headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Any response (even 4xx/5xx) means the server is reachable
      return { reachable: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('HTTP connectivity check failed', { error: message });
      return {
        reachable: false,
        error: message,
      };
    }
  }
}

/**
 * Creates fetch options with the configured headers
 */
export function createFetchOptions(
  config: HttpServerConfig,
  method: string = 'POST',
  body?: string
): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    body,
  };
}
