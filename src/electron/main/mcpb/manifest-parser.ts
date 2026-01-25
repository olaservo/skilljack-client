/**
 * MCPB Manifest Parser
 *
 * Parses and validates MCPB manifest.json files.
 */

import { readFileSync } from 'fs';
import type { McpbManifest } from './types.js';

export interface ParseResult {
  success: boolean;
  manifest?: McpbManifest;
  error?: string;
}

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Parse manifest from JSON string
 */
export function parseManifest(manifestJson: string): ParseResult {
  try {
    const manifest = JSON.parse(manifestJson);
    const errors = validateManifest(manifest);

    if (errors.length > 0) {
      const errorMessages = errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      return {
        success: false,
        error: `Invalid manifest: ${errorMessages}`,
      };
    }

    return {
      success: true,
      manifest: manifest as McpbManifest,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse manifest JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Parse manifest from file path
 */
export function parseManifestFile(manifestPath: string): ParseResult {
  try {
    const content = readFileSync(manifestPath, 'utf-8');
    return parseManifest(content);
  } catch (error) {
    return {
      success: false,
      error: `Failed to read manifest file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Validate manifest object structure
 */
function validateManifest(manifest: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!manifest || typeof manifest !== 'object') {
    errors.push({ field: 'root', message: 'Manifest must be an object' });
    return errors;
  }

  const obj = manifest as Record<string, unknown>;

  // Check manifest version
  if (!obj.manifest_version && !obj.dxt_version) {
    errors.push({
      field: 'manifest_version',
      message: 'Either manifest_version or dxt_version is required',
    });
  }

  // Required string fields
  const requiredStrings = ['name', 'version', 'description'];
  for (const field of requiredStrings) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).trim() === '') {
      errors.push({ field, message: 'Must be a non-empty string' });
    }
  }

  // Validate author
  if (!obj.author || typeof obj.author !== 'object') {
    errors.push({ field: 'author', message: 'Must be an object' });
  } else {
    const author = obj.author as Record<string, unknown>;
    if (typeof author.name !== 'string' || author.name.trim() === '') {
      errors.push({ field: 'author.name', message: 'Must be a non-empty string' });
    }
  }

  // Validate server
  if (!obj.server || typeof obj.server !== 'object') {
    errors.push({ field: 'server', message: 'Must be an object' });
  } else {
    const server = obj.server as Record<string, unknown>;

    // Validate server.type
    const validTypes = ['node', 'python', 'binary'];
    if (!validTypes.includes(server.type as string)) {
      errors.push({
        field: 'server.type',
        message: `Must be one of: ${validTypes.join(', ')}`,
      });
    }

    // Validate server.entry_point
    if (typeof server.entry_point !== 'string' || server.entry_point.trim() === '') {
      errors.push({ field: 'server.entry_point', message: 'Must be a non-empty string' });
    }

    // Validate server.mcp_config
    if (!server.mcp_config || typeof server.mcp_config !== 'object') {
      errors.push({ field: 'server.mcp_config', message: 'Must be an object' });
    } else {
      const mcpConfig = server.mcp_config as Record<string, unknown>;
      if (typeof mcpConfig.command !== 'string' || mcpConfig.command.trim() === '') {
        errors.push({ field: 'server.mcp_config.command', message: 'Must be a non-empty string' });
      }
    }
  }

  // Validate user_config if present
  if (obj.user_config !== undefined) {
    if (typeof obj.user_config !== 'object' || obj.user_config === null) {
      errors.push({ field: 'user_config', message: 'Must be an object' });
    } else {
      const userConfig = obj.user_config as Record<string, unknown>;
      const validTypes = ['string', 'number', 'boolean', 'directory', 'file'];

      for (const [key, value] of Object.entries(userConfig)) {
        if (!value || typeof value !== 'object') {
          errors.push({ field: `user_config.${key}`, message: 'Must be an object' });
          continue;
        }

        const option = value as Record<string, unknown>;

        if (!validTypes.includes(option.type as string)) {
          errors.push({
            field: `user_config.${key}.type`,
            message: `Must be one of: ${validTypes.join(', ')}`,
          });
        }

        if (typeof option.title !== 'string') {
          errors.push({ field: `user_config.${key}.title`, message: 'Must be a string' });
        }

        if (typeof option.description !== 'string') {
          errors.push({ field: `user_config.${key}.description`, message: 'Must be a string' });
        }
      }
    }
  }

  return errors;
}

/**
 * Check if manifest is compatible with current platform
 */
export function checkPlatformCompatibility(manifest: McpbManifest): boolean {
  if (!manifest.compatibility?.platforms) {
    return true; // No platform restriction
  }

  const currentPlatform = process.platform as 'darwin' | 'win32' | 'linux';
  return manifest.compatibility.platforms.includes(currentPlatform);
}

/**
 * Get list of required user config fields that are missing
 */
export function getMissingRequiredConfig(
  manifest: McpbManifest,
  userConfig?: Record<string, unknown>
): string[] {
  const missing: string[] = [];

  if (!manifest.user_config) {
    return missing;
  }

  const providedConfig = userConfig || {};

  for (const [key, option] of Object.entries(manifest.user_config)) {
    if (option.required) {
      const value = providedConfig[key];

      // Check if value is missing or empty
      if (
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && (value.length === 0 || value.some((v) => v === '' || v === null)))
      ) {
        missing.push(key);
      }
    }
  }

  return missing;
}
