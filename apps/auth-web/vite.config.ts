/**
 * @fileoverview Implements the public authentication-only React bundle that discovers tenant login methods and begins server-owned OAuth/passkey flows.
 *
 * @remarks
 * Direct links: `@tailwindcss/vite`, `@vitejs/plugin-react`, `vite`, `/auth/`, `/api`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/auth/',
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: false,
    target: 'es2022',
    cssCodeSplit: true,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/auth-[hash].js',
        chunkFileNames: 'assets/auth-chunk-[hash].js',
        assetFileNames: 'assets/auth-[hash][extname]',
      },
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
});
