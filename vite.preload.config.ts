/**
 * Vite Configuration for Electron Preload Script
 *
 * Builds the preload script that bridges main and renderer processes.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Output ESM format to match "type": "module" in package.json
    lib: {
      entry: 'src/electron/preload/host.ts',
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'electron',
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
