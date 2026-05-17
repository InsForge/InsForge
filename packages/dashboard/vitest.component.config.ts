import { defineConfig, mergeConfig } from 'vitest/config';

import sharedConfig from './vitest.shared.config';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.tsx'],
      setupFiles: ['./src/test/setup.ts'],
    },
  })
);
