/**
 * UI Resource Loaders for internal-tool-manager
 *
 * For standalone server mode, reads HTML from file.
 * When bundled into Electron app, the main app handles UI loading directly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Resolved lazily: when this package is bundled into the Electron main
// process (CJS), import.meta.url is unavailable — but that build loads UI
// HTML via ?raw imports and never calls getToolManagerUI().
function getModuleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

// Cache for loaded UI content
let toolManagerUICache: string | null = null;

/**
 * Get the Tool Manager UI HTML content.
 * Loads from file and caches the result.
 */
export function getToolManagerUI(): string {
  if (toolManagerUICache === null) {
    const htmlPath = join(getModuleDir(), 'mcp-app.html');
    toolManagerUICache = readFileSync(htmlPath, 'utf-8');
  }
  return toolManagerUICache;
}

/**
 * Clear the UI cache (useful for development/hot-reload).
 */
export function clearUICache(): void {
  toolManagerUICache = null;
}
