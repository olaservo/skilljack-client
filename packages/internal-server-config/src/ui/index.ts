/**
 * UI Resource Loaders for internal-server-config
 *
 * For standalone server mode, reads HTML from file.
 * When bundled into Electron app, the main app handles UI loading directly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Resolved lazily: when this package is bundled into the Electron main
// process (CJS), import.meta.url is unavailable — but that build loads UI
// HTML via ?raw imports and never calls these loaders.
function getModuleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

// Cache for loaded UI content
let serverConfigUICache: string | null = null;
let mcpbConfirmUICache: string | null = null;

/**
 * Get the Server Configuration UI HTML content.
 * Loads from file and caches the result.
 */
export function getServerConfigUI(): string {
  if (serverConfigUICache === null) {
    const htmlPath = join(getModuleDir(), 'server-config.html');
    serverConfigUICache = readFileSync(htmlPath, 'utf-8');
  }
  return serverConfigUICache;
}

/**
 * Get the MCPB Confirmation UI HTML content.
 * Loads from file and caches the result.
 */
export function getMcpbConfirmUI(): string {
  if (mcpbConfirmUICache === null) {
    const htmlPath = join(getModuleDir(), 'mcpb-confirm.html');
    mcpbConfirmUICache = readFileSync(htmlPath, 'utf-8');
  }
  return mcpbConfirmUICache;
}

/**
 * Clear the UI cache (useful for development/hot-reload).
 */
export function clearUICache(): void {
  serverConfigUICache = null;
  mcpbConfirmUICache = null;
}
