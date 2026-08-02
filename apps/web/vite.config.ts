import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@myfinance/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url)
      ),
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
    },
  },
});
