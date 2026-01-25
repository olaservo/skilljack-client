/**
 * UI Resource Loaders for internal-tool-manager
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache for loaded UI content
let toolManagerUICache: string | null = null;

/**
 * Get the Tool Manager UI HTML content.
 * Loads from file and caches the result.
 */
export function getToolManagerUI(): string {
  if (toolManagerUICache === null) {
    const htmlPath = join(__dirname, 'mcp-app.html');
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
