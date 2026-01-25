/**
 * UI Resource Loaders for internal-server-config
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache for loaded UI content
let serverConfigUICache: string | null = null;
let mcpbConfirmUICache: string | null = null;

/**
 * Get the Server Configuration UI HTML content.
 * Loads from file and caches the result.
 */
export function getServerConfigUI(): string {
  if (serverConfigUICache === null) {
    const htmlPath = join(__dirname, 'server-config.html');
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
    const htmlPath = join(__dirname, 'mcpb-confirm.html');
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
