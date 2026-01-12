import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    // Replace process.env references for browser compatibility
    'process.env': {},
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'src/web/static/chat',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/web/chat/index.tsx'),
      name: 'SkilljackChat',
      fileName: 'bundle',
      formats: ['iife'],
    },
    rollupOptions: {
      // React is bundled (not external) since we're building an IIFE
      output: {
        assetFileNames: '[name].[ext]',
      },
    },
  },
  server: {
    // Dev server proxies API calls to the main server
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
