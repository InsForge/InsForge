import { defineConfig, mergeConfig } from 'vitest/config';

import sharedConfig from './vitest.shared.config';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
    },
  })
);
