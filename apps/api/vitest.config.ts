import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@myfinance/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url)
      ),
    },
  },
  test: {
    fileParallelism: false,
  },
});
