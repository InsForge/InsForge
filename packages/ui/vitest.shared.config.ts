import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@insforge/ui': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
});
