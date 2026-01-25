/**
 * MCPB (MCP Bundle) Installer
 *
 * Main entry point for MCPB installation functionality.
 * Provides preview and install capabilities for MCPB bundles.
 */

import { app } from 'electron';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { basename, join } from 'path';
import log from 'electron-log';

import { verifySignature } from './signature.js';
import { unpackMcpb, readManifestFromMcpb } from './unpacker.js';
import {
  parseManifest,
  checkPlatformCompatibility,
  getMissingRequiredConfig,
} from './manifest-parser.js';
import { resolveServerConfig, resolveDefaultValue } from './variable-resolver.js';
import type {
  McpbPreviewResult,
  McpbInstallOptions,
  McpbInstallResult,
  McpbManifest,
} from './types.js';

// Re-export types and functions for convenience
export * from './types.js';
export { resolveDefaultValue } from './variable-resolver.js';

/**
 * Get the extensions installation directory
 */
export function getExtensionsDir(): string {
  return join(app.getPath('userData'), 'extensions');
}

/**
 * Preview an MCPB file without installing
 *
 * Reads the manifest and verifies the signature without extracting.
 * Use this to show confirmation UI before installation.
 *
 * @param mcpbPath Path to the .mcpb file
 * @returns Preview result with manifest, signature info, and validation status
 */
export async function previewMcpb(mcpbPath: string): Promise<McpbPreviewResult> {
  log.info('[MCPB] Previewing:', mcpbPath);

  // Verify file exists
  if (!existsSync(mcpbPath)) {
    throw new Error(`MCPB file not found: ${mcpbPath}`);
  }

  // Read manifest without extracting
  const manifestJson = readManifestFromMcpb(mcpbPath);
  if (!manifestJson) {
    throw new Error('manifest.json not found in MCPB file');
  }

  // Parse and validate manifest
  const parseResult = parseManifest(manifestJson);
  if (!parseResult.success || !parseResult.manifest) {
    throw new Error(parseResult.error || 'Invalid manifest');
  }

  const manifest = parseResult.manifest;

  // Verify signature
  const signature = await verifySignature(mcpbPath);
  log.info('[MCPB] Signature status:', signature.status);

  // Check platform compatibility
  const platformCompatible = checkPlatformCompatibility(manifest);

  // Get missing required config (without user config provided yet)
  const missingRequiredConfig = getMissingRequiredConfig(manifest);

  return {
    mcpbPath,
    manifest,
    signature,
    platformCompatible,
    missingRequiredConfig,
  };
}

/**
 * Install an MCPB file
 *
 * Extracts the bundle, validates the manifest, resolves variables,
 * and returns the configuration ready for server registration.
 *
 * @param options Installation options
 * @returns Installation result with resolved server configuration
 */
export async function installMcpb(options: McpbInstallOptions): Promise<McpbInstallResult> {
  const { mcpbPath, userConfig, serverName: overrideName } = options;

  log.info('[MCPB] Installing:', mcpbPath);

  // Verify file exists
  if (!existsSync(mcpbPath)) {
    return {
      success: false,
      serverName: '',
      message: `MCPB file not found: ${mcpbPath}`,
    };
  }

  // Read manifest without extracting first to validate
  const manifestJson = readManifestFromMcpb(mcpbPath);
  if (!manifestJson) {
    return {
      success: false,
      serverName: '',
      message: 'manifest.json not found in MCPB file',
    };
  }

  // Parse and validate manifest
  const parseResult = parseManifest(manifestJson);
  if (!parseResult.success || !parseResult.manifest) {
    return {
      success: false,
      serverName: '',
      message: parseResult.error || 'Invalid manifest',
    };
  }

  const manifest = parseResult.manifest;
  const finalServerName = overrideName || manifest.name;

  // Check platform compatibility
  if (!checkPlatformCompatibility(manifest)) {
    return {
      success: false,
      serverName: finalServerName,
      message: `Extension is not compatible with platform: ${process.platform}`,
    };
  }

  // Check for missing required config
  const missingConfig = getMissingRequiredConfig(manifest, userConfig);
  if (missingConfig.length > 0) {
    return {
      success: false,
      serverName: finalServerName,
      message: `Missing required configuration: ${missingConfig.join(', ')}`,
    };
  }

  // Determine installation directory
  const extensionsDir = getExtensionsDir();
  if (!existsSync(extensionsDir)) {
    mkdirSync(extensionsDir, { recursive: true });
  }

  // Create unique directory for this extension
  const mcpbBasename = basename(mcpbPath, '.mcpb');
  const installPath = join(extensionsDir, mcpbBasename);

  // Remove existing installation if present
  if (existsSync(installPath)) {
    log.info('[MCPB] Removing existing installation:', installPath);
    rmSync(installPath, { recursive: true, force: true });
  }

  // Unpack MCPB
  const unpackResult = unpackMcpb(mcpbPath, installPath);
  if (!unpackResult.success) {
    return {
      success: false,
      serverName: finalServerName,
      message: unpackResult.error || 'Failed to unpack MCPB',
    };
  }

  log.info('[MCPB] Unpacked to:', installPath);

  // Resolve variables in mcp_config
  const resolvedConfig = resolveServerConfig(manifest, installPath, userConfig);

  const displayName = manifest.display_name || manifest.name;
  log.info('[MCPB] Installation complete:', displayName, 'v' + manifest.version);

  return {
    success: true,
    serverName: finalServerName,
    message: `Successfully installed ${displayName} v${manifest.version}`,
    installPath,
    config: resolvedConfig,
  };
}

/**
 * Uninstall an MCPB extension
 *
 * Removes the extension directory from the extensions folder.
 * Note: This does not remove the server configuration - that must be done separately.
 *
 * @param extensionName Name of the extension (directory name in extensions folder)
 * @returns true if uninstalled successfully
 */
export function uninstallMcpb(extensionName: string): boolean {
  const extensionsDir = getExtensionsDir();
  const installPath = join(extensionsDir, extensionName);

  if (!existsSync(installPath)) {
    log.warn('[MCPB] Extension not found:', extensionName);
    return false;
  }

  try {
    rmSync(installPath, { recursive: true, force: true });
    log.info('[MCPB] Uninstalled:', extensionName);
    return true;
  } catch (error) {
    log.error('[MCPB] Failed to uninstall:', error);
    return false;
  }
}

/**
 * Get manifest for preview display
 *
 * Helper to extract display-friendly manifest information
 */
export function getManifestDisplayInfo(manifest: McpbManifest): {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  tools: Array<{ name: string; description?: string }>;
  hasUserConfig: boolean;
  userConfigFields: Array<{
    key: string;
    type: string;
    title: string;
    description: string;
    required: boolean;
    sensitive: boolean;
    default?: unknown;
  }>;
} {
  const userConfigFields: Array<{
    key: string;
    type: string;
    title: string;
    description: string;
    required: boolean;
    sensitive: boolean;
    default?: unknown;
  }> = [];

  if (manifest.user_config) {
    for (const [key, option] of Object.entries(manifest.user_config)) {
      userConfigFields.push({
        key,
        type: option.type,
        title: option.title,
        description: option.description,
        required: option.required ?? false,
        sensitive: option.sensitive ?? false,
        default: resolveDefaultValue(option.default),
      });
    }
  }

  return {
    name: manifest.name,
    displayName: manifest.display_name || manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author.name,
    tools: manifest.tools || [],
    hasUserConfig: userConfigFields.length > 0,
    userConfigFields,
  };
}
