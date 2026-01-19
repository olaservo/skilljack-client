/**
 * Vite Configuration for Electron Main Process
 *
 * Builds the main process entry point with Node.js compatibility.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Output ESM format to match "type": "module" in package.json
    lib: {
      entry: 'src/electron/main/index.ts',
      formats: ['es'],
    },
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
        'node:module',
        'node:process',
        'node:readline',
        // Also treat non-prefixed versions as external
        'fs',
        'path',
        'child_process',
        'http',
        'https',
        'stream',
        'events',
        'util',
        'os',
        'crypto',
        'readline',
      ],
      output: {
        format: 'es',
      },
    },
  },
  resolve: {
    // Allow importing .js extensions for ESM compatibility
    extensions: ['.ts', '.js', '.mjs'],
  },
});
