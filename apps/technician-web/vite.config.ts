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
  base: '/technician/',
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: false,
    target: 'es2022',
    cssCodeSplit: true,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/technician-[hash].js',
        chunkFileNames: 'assets/technician-chunk-[hash].js',
        assetFileNames: 'assets/technician-[hash][extname]',
      },
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
});
