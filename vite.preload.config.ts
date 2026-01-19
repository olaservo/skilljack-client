/**
 * Vite Configuration for Electron Preload Script
 *
 * Builds the preload script that bridges main and renderer processes.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
      ],
    },
  },
  resolve: {
    // Allow importing .js extensions for ESM compatibility
    extensions: ['.ts', '.js', '.mjs'],
  },
});
