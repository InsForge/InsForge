import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'component',
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
