/**
 * Vite Configuration for Electron Main Process
 *
 * Builds the main process entry point with Node.js compatibility.
 * Uses CJS format with .cjs extension to work with "type": "module" in package.json.
 * Bundles all dependencies except electron and native modules.
 */

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    // Prefer ESM versions of packages for better bundling
    mainFields: ['module', 'jsnext:main', 'jsnext', 'main'],
    extensions: ['.ts', '.js', '.mjs', '.cjs'],
  },
  build: {
    // Output CJS format - required because bundled deps use require()
    lib: {
      entry: 'src/electron/main/index.ts',
      // Use .cjs extension because package.json has "type": "module"
      fileName: () => 'main.cjs',
      formats: ['cjs'],
    },
    rollupOptions: {
      // Only externalize modules that can't be bundled
      external: [
        // Electron itself (provided by runtime)
        'electron',
        // Native modules that require node-gyp
        // Add any native addons here if needed
      ],
      output: {
        // Inline dynamic imports for single-file output
        inlineDynamicImports: true,
      },
    },
    // Don't minify for easier debugging
    minify: false,
    // Generate source maps
    sourcemap: true,
  },
});
