/**
 * Vite Configuration for Electron Preload Script
 *
 * Builds the preload script that bridges main and renderer processes.
 * Uses CJS format with .cjs extension to work with "type": "module" in package.json.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.cjs'],
  },
  build: {
    // Output CJS format for consistency with main process
    lib: {
      entry: 'src/electron/preload/host.ts',
      // Use .cjs extension because package.json has "type": "module"
      fileName: () => 'preload.cjs',
      formats: ['cjs'],
    },
    rollupOptions: {
      // Externalize electron (required for preload)
      external: ['electron'],
      output: {
        inlineDynamicImports: true,
        // Force .cjs extension so Node treats it as CommonJS
        entryFileNames: 'preload.cjs',
      },
    },
    minify: false,
    sourcemap: true,
  },
});
