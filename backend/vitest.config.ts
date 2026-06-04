import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@insforge/shared-schemas': path.resolve(__dirname, '../packages/shared-schemas/src'),
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
    // Run tests sequentially to avoid database conflicts. Vitest 4 removed
    // poolOptions.forks.singleFork; `maxWorkers: 1` reproduces it here: a
    // single worker runs test files one at a time. Isolation stays at its
    // default (true) — matching v3 `singleFork: true`, which shared the fork
    // process but still reset module state per file. (`isolate: false` is
    // intentionally NOT set: it breaks tests that rely on per-file module
    // resets, e.g. function-security and smtp-link-validation.)
    pool: 'forks',
    maxWorkers: 1,
  },
});
