/**
 * MCPB Variable Resolver
 *
 * Performs variable substitution in MCPB manifest mcp_config.
 * Adapted from mcpb-reference implementation.
 */

import { homedir } from 'os';
import { sep } from 'path';
import type { McpbManifest, ResolvedServerConfig } from './types.js';

/**
 * System directories for variable substitution
 */
export interface SystemDirs {
  HOME: string;
  DESKTOP?: string;
  DOCUMENTS?: string;
  DOWNLOADS?: string;
}

/**
 * Get system directories for the current platform
 */
export function getSystemDirs(): SystemDirs {
  const home = homedir();
  const isWindows = process.platform === 'win32';

  return {
    HOME: home,
    DESKTOP: isWindows
      ? `${home}\\Desktop`
      : `${home}/Desktop`,
    DOCUMENTS: isWindows
      ? `${home}\\Documents`
      : `${home}/Documents`,
    DOWNLOADS: isWindows
      ? `${home}\\Downloads`
      : `${home}/Downloads`,
  };
}

/**
 * Recursively replace variables in any value
 *
 * Handles strings, arrays, and objects.
 * For arrays, variables that expand to arrays are expanded inline.
 */
function replaceVariables(
  value: unknown,
  variables: Record<string, string | string[]>
): unknown {
  if (typeof value === 'string') {
    let result = value;

    // Replace all variables in the string
    for (const [key, replacement] of Object.entries(variables)) {
      const pattern = new RegExp(`\\$\\{${key}\\}`, 'g');

      // Check if this pattern actually exists in the string
      if (result.match(pattern)) {
        if (Array.isArray(replacement)) {
          // Can't replace with array in string context - join with space
          result = result.replace(pattern, replacement.join(' '));
        } else {
          result = result.replace(pattern, replacement);
        }
      }
    }

    return result;
  } else if (Array.isArray(value)) {
    // For arrays, handle special case of array expansion
    const result: unknown[] = [];

    for (const item of value) {
      if (
        typeof item === 'string' &&
        item.match(/^\$\{user_config\.[^}]+\}$/)
      ) {
        // This is a user config variable that might expand to multiple values
        const varName = item.match(/^\$\{([^}]+)\}$/)?.[1];
        if (varName && variables[varName]) {
          const replacement = variables[varName];
          if (Array.isArray(replacement)) {
            // Expand array inline
            result.push(...replacement);
          } else {
            result.push(replacement);
          }
        } else {
          // Variable not found, keep original
          result.push(item);
        }
      } else {
        // Recursively process non-variable items
        result.push(replaceVariables(item, variables));
      }
    }

    return result;
  } else if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = replaceVariables(val, variables);
    }
    return result;
  }

  return value;
}

/**
 * Resolve variables in manifest's mcp_config
 *
 * @param manifest The MCPB manifest
 * @param extensionPath Path where the extension is installed
 * @param userConfig User-provided configuration values
 * @returns Resolved server configuration ready for use
 */
export function resolveServerConfig(
  manifest: McpbManifest,
  extensionPath: string,
  userConfig?: Record<string, unknown>
): ResolvedServerConfig {
  const systemDirs = getSystemDirs();

  // Build variables map
  const variables: Record<string, string | string[]> = {
    __dirname: extensionPath,
    pathSeparator: sep,
    '/': sep,
    ...systemDirs,
  };

  // Build merged configuration from defaults and user settings
  const mergedConfig: Record<string, unknown> = {};

  // First, add defaults from manifest
  if (manifest.user_config) {
    for (const [key, configOption] of Object.entries(manifest.user_config)) {
      if (configOption.default !== undefined) {
        mergedConfig[key] = configOption.default;
      }
    }
  }

  // Then, override with user settings
  if (userConfig) {
    Object.assign(mergedConfig, userConfig);
  }

  // Add merged configuration variables for substitution
  for (const [key, value] of Object.entries(mergedConfig)) {
    const userConfigKey = `user_config.${key}`;

    if (Array.isArray(value)) {
      // Keep arrays as arrays for proper expansion
      variables[userConfigKey] = value.map(String);
    } else if (typeof value === 'boolean') {
      // Convert booleans to "true"/"false" strings as per spec
      variables[userConfigKey] = value ? 'true' : 'false';
    } else {
      // Convert other types to strings
      variables[userConfigKey] = String(value);
    }
  }

  // Get base config with platform overrides applied
  const baseConfig = manifest.server.mcp_config;
  let mcpConfig = {
    command: baseConfig.command,
    args: baseConfig.args || [],
    env: baseConfig.env || {},
  };

  // Apply platform-specific overrides
  if (baseConfig.platform_overrides?.[process.platform]) {
    const override = baseConfig.platform_overrides[process.platform];
    mcpConfig = {
      command: override.command ?? mcpConfig.command,
      args: override.args ?? mcpConfig.args,
      env: override.env ?? mcpConfig.env,
    };
  }

  // Replace variables recursively
  const resolved = replaceVariables(mcpConfig, variables) as {
    command: string;
    args: string[];
    env: Record<string, string>;
  };

  return {
    command: resolved.command,
    args: resolved.args,
    env: resolved.env,
  };
}

/**
 * Resolve default values for user config display
 *
 * Replaces system variables like ${HOME} with actual values
 */
export function resolveDefaultValue(
  defaultValue: string | number | boolean | string[] | undefined,
  extensionPath?: string
): string | number | boolean | string[] | undefined {
  if (defaultValue === undefined) {
    return undefined;
  }

  if (typeof defaultValue !== 'string') {
    return defaultValue;
  }

  const systemDirs = getSystemDirs();
  const variables: Record<string, string> = {
    ...systemDirs,
    pathSeparator: sep,
    '/': sep,
  };

  if (extensionPath) {
    variables.__dirname = extensionPath;
  }

  let result = defaultValue;
  for (const [key, replacement] of Object.entries(variables)) {
    const pattern = new RegExp(`\\$\\{${key}\\}`, 'g');
    result = result.replace(pattern, replacement);
  }

  return result;
}
