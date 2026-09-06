/**
 * @fileoverview Implements the protected React portal entry/configuration and is served only after the backend verifies an opaque session.
 *
 * @remarks
 * Direct links: `@tailwindcss/vite`, `@vitejs/plugin-react`, `vite`, `/app/`, `/api`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: false,
    target: 'es2022',
    cssCodeSplit: true,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/portal-[hash].js',
        chunkFileNames: 'assets/portal-chunk-[hash].js',
        assetFileNames: 'assets/portal-[hash][extname]',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local'],
    proxy: { '/api': 'http://localhost:8080' },
  },
});
