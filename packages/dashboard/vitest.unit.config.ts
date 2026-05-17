import { defineConfig, mergeConfig } from 'vitest/config';

import sharedConfig from './vitest.shared.config';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  })
);
