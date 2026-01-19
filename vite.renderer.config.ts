/**
 * Vite Configuration for Electron Renderer Process
 *
 * Builds the React UI for the Electron window.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/renderer'),
  build: {
    outDir: resolve(__dirname, '.vite/renderer/main_window'),
    emptyOutDir: true,
  },
  define: {
    // Replace process.env references for browser compatibility
    'process.env': {},
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@communication': resolve(__dirname, 'src/communication'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  server: {
    // Dev server for HMR
    port: 5173,
  },
});
