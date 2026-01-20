/**
 * Configuration loading and validation for MCP server manager
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type {
  ManagerConfig,
  ServerConfig,
  LifecycleConfig,
  StdioServerConfig,
  HttpServerConfig,
} from '../types/config.js';
import { DEFAULT_LIFECYCLE_CONFIG } from '../types/config.js';
import { createLogger, type Logger } from '../utils/logger.js';

/**
 * Validation error details
 */
export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Result of configuration validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Loads and validates MCP server manager configuration
 */
export class ConfigLoader {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createLogger('ConfigLoader');
  }

  /**
   * Loads configuration from a JSON file
   */
  async loadFromFile(filePath: string): Promise<ManagerConfig> {
    this.logger.info('Loading configuration from file', { filePath });

    if (!existsSync(filePath)) {
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    const content = await readFile(filePath, 'utf-8');
    let rawConfig: unknown;

    try {
      rawConfig = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Invalid JSON in configuration file: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return this.parseAndValidate(rawConfig);
  }

  /**
   * Loads configuration from a raw object
   */
  loadFromObject(config: unknown): ManagerConfig {
    return this.parseAndValidate(config);
  }

  /**
   * Parses and validates raw configuration
   */
  private parseAndValidate(raw: unknown): ManagerConfig {
    const validation = this.validate(raw);

    if (!validation.valid) {
      const errorMessages = validation.errors
        .map((e) => `  - ${e.path}: ${e.message}`)
        .join('\n');
      throw new Error(`Invalid configuration:\n${errorMessages}`);
    }

    const config = raw as ManagerConfig;

    // Apply defaults
    return this.applyDefaults(config);
  }

  /**
   * Validates raw configuration object
   */
  validate(config: unknown): ValidationResult {
    const errors: ValidationError[] = [];

    if (!config || typeof config !== 'object') {
      errors.push({ path: '', message: 'Configuration must be an object' });
      return { valid: false, errors };
    }

    const obj = config as Record<string, unknown>;

    // Validate servers array
    if (!Array.isArray(obj.servers)) {
      errors.push({ path: 'servers', message: 'Must be an array' });
      return { valid: false, errors };
    }

    // Validate each server
    const serverNames = new Set<string>();
    obj.servers.forEach((server, index) => {
      const serverErrors = this.validateServer(server, `servers[${index}]`);
      errors.push(...serverErrors);

      // Check for duplicate names
      if (
        server &&
        typeof server === 'object' &&
        'name' in server &&
        typeof (server as { name: unknown }).name === 'string'
      ) {
        const name = (server as { name: string }).name;
        if (serverNames.has(name)) {
          errors.push({
            path: `servers[${index}].name`,
            message: `Duplicate server name: ${name}`,
          });
        }
        serverNames.add(name);
      }
    });

    // Validate global defaults if present
    if (obj.defaults !== undefined) {
      const defaultsErrors = this.validateLifecycleConfig(obj.defaults, 'defaults');
      errors.push(...defaultsErrors);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validates a single server configuration
   */
  private validateServer(server: unknown, path: string): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!server || typeof server !== 'object') {
      errors.push({ path, message: 'Server must be an object' });
      return errors;
    }

    const obj = server as Record<string, unknown>;

    // Validate name
    if (typeof obj.name !== 'string' || obj.name.trim() === '') {
      errors.push({ path: `${path}.name`, message: 'Must be a non-empty string' });
    }

    // Validate connection
    if (!obj.connection || typeof obj.connection !== 'object') {
      errors.push({ path: `${path}.connection`, message: 'Must be an object' });
    } else {
      const connErrors = this.validateConnection(obj.connection, `${path}.connection`);
      errors.push(...connErrors);
    }

    // Validate lifecycle if present
    if (obj.lifecycle !== undefined) {
      const lifecycleErrors = this.validateLifecycleConfig(obj.lifecycle, `${path}.lifecycle`);
      errors.push(...lifecycleErrors);
    }

    // Validate autoStart if present
    if (obj.autoStart !== undefined && typeof obj.autoStart !== 'boolean') {
      errors.push({ path: `${path}.autoStart`, message: 'Must be a boolean' });
    }

    return errors;
  }

  /**
   * Validates connection configuration
   */
  private validateConnection(connection: unknown, path: string): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!connection || typeof connection !== 'object') {
      errors.push({ path, message: 'Connection must be an object' });
      return errors;
    }

    const obj = connection as Record<string, unknown>;

    if (obj.type === 'stdio') {
      // Validate stdio connection
      if (typeof obj.command !== 'string' || obj.command.trim() === '') {
        errors.push({ path: `${path}.command`, message: 'Must be a non-empty string' });
      }
      if (obj.args !== undefined && !Array.isArray(obj.args)) {
        errors.push({ path: `${path}.args`, message: 'Must be an array of strings' });
      }
      if (obj.args && Array.isArray(obj.args)) {
        obj.args.forEach((arg, i) => {
          if (typeof arg !== 'string') {
            errors.push({ path: `${path}.args[${i}]`, message: 'Must be a string' });
          }
        });
      }
      if (obj.env !== undefined && (typeof obj.env !== 'object' || obj.env === null)) {
        errors.push({ path: `${path}.env`, message: 'Must be an object' });
      }
      if (obj.cwd !== undefined && typeof obj.cwd !== 'string') {
        errors.push({ path: `${path}.cwd`, message: 'Must be a string' });
      }
    } else if (obj.type === 'http') {
      // Validate HTTP connection
      if (typeof obj.url !== 'string' || obj.url.trim() === '') {
        errors.push({ path: `${path}.url`, message: 'Must be a non-empty string' });
      } else {
        try {
          new URL(obj.url);
        } catch {
          errors.push({ path: `${path}.url`, message: 'Must be a valid URL' });
        }
      }
      if (obj.headers !== undefined && (typeof obj.headers !== 'object' || obj.headers === null)) {
        errors.push({ path: `${path}.headers`, message: 'Must be an object' });
      }
    } else {
      errors.push({
        path: `${path}.type`,
        message: 'Must be "stdio" or "http"',
      });
    }

    return errors;
  }

  /**
   * Validates lifecycle configuration
   */
  private validateLifecycleConfig(lifecycle: unknown, path: string): ValidationError[] {
    const errors: ValidationError[] = [];

    if (typeof lifecycle !== 'object' || lifecycle === null) {
      errors.push({ path, message: 'Must be an object' });
      return errors;
    }

    const obj = lifecycle as Record<string, unknown>;

    const booleanFields = ['healthCheckEnabled', 'autoRestartEnabled'];
    const numberFields = [
      'healthCheckIntervalMs',
      'healthCheckTimeoutMs',
      'unhealthyThreshold',
      'maxRestartAttempts',
      'restartBackoffBaseMs',
      'restartBackoffMaxMs',
      'shutdownTimeoutMs',
    ];

    booleanFields.forEach((field) => {
      if (obj[field] !== undefined && typeof obj[field] !== 'boolean') {
        errors.push({ path: `${path}.${field}`, message: 'Must be a boolean' });
      }
    });

    numberFields.forEach((field) => {
      if (obj[field] !== undefined) {
        if (typeof obj[field] !== 'number' || obj[field] < 0) {
          errors.push({ path: `${path}.${field}`, message: 'Must be a non-negative number' });
        }
      }
    });

    return errors;
  }

  /**
   * Applies default values to configuration
   */
  private applyDefaults(config: ManagerConfig): ManagerConfig {
    const globalDefaults = config.defaults ?? {};

    const servers = config.servers.map((server) => ({
      ...server,
      autoStart: server.autoStart ?? true,
      lifecycle: {
        ...DEFAULT_LIFECYCLE_CONFIG,
        ...globalDefaults,
        ...server.lifecycle,
      },
    }));

    return {
      ...config,
      servers,
    };
  }
}

/**
 * Creates a server configuration programmatically
 */
export function createServerConfig(
  name: string,
  connection: StdioServerConfig | HttpServerConfig,
  options?: {
    lifecycle?: LifecycleConfig;
    autoStart?: boolean;
  }
): ServerConfig {
  return {
    name,
    connection,
    lifecycle: options?.lifecycle,
    autoStart: options?.autoStart,
  };
}

/**
 * Creates a stdio server configuration
 */
export function createStdioConfig(
  command: string,
  args?: string[],
  options?: {
    env?: Record<string, string>;
    cwd?: string;
  }
): StdioServerConfig {
  return {
    type: 'stdio',
    command,
    args,
    env: options?.env,
    cwd: options?.cwd,
  };
}

/**
 * Creates an HTTP server configuration
 */
export function createHttpConfig(
  url: string,
  headers?: Record<string, string>
): HttpServerConfig {
  return {
    type: 'http',
    url,
    headers,
  };
}
