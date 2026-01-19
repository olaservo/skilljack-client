/**
 * Vite Configuration for Electron Main Process
 *
 * Builds the main process entry point with Node.js compatibility.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
        'electron-store',
        'electron-log',
        'electron-squirrel-startup',
        // Node built-ins
        'node:fs',
        'node:fs/promises',
        'node:path',
        'node:url',
        'node:child_process',
        'node:http',
        'node:https',
        'node:stream',
        'node:events',
        'node:util',
        'node:os',
        'node:crypto',
      ],
    },
  },
  resolve: {
    // Allow importing .js extensions for ESM compatibility
    extensions: ['.ts', '.js', '.mjs'],
  },
});
