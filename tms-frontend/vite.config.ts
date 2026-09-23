/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = new URL('.', import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': `${repoRoot}src` },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    coverage: { provider: 'v8', reportsDirectory: './coverage' },
  },
});
