import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({

    resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    },

  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'frontend/', 'tests/', '**/*.d.ts', '**/*.config.*'],
    },

  
    testTimeout: 10000,
    // Run tests sequentially to avoid database conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
