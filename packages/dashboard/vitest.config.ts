import path from 'node:path';
import { defineConfig } from 'vitest/config';

const dashboardSrcPath = path.resolve(__dirname, 'src');

export default defineConfig({
  resolve: {
    alias: {
      '#app': path.resolve(dashboardSrcPath, 'app'),
      '#assets': path.resolve(dashboardSrcPath, 'assets'),
      '#components': path.resolve(dashboardSrcPath, 'components'),
      '#features': path.resolve(dashboardSrcPath, 'features'),
      '#layout': path.resolve(dashboardSrcPath, 'layout'),
      '#lib': path.resolve(dashboardSrcPath, 'lib'),
      '#navigation': path.resolve(dashboardSrcPath, 'navigation'),
      '#router': path.resolve(dashboardSrcPath, 'router'),
      '#types': path.resolve(dashboardSrcPath, 'types'),
      '@insforge/shared-schemas': path.resolve(__dirname, '../shared-schemas/src'),
      '@insforge/ui': path.resolve(__dirname, '../ui/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
