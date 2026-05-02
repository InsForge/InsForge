import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const BACKEND_URL = process.env.VITE_API_BASE_URL || 'http://localhost:7130';
const dashboardSrcPath = path.resolve(__dirname, '../packages/dashboard/src');

export default defineConfig({
  plugins: [react(), tailwindcss(), svgr()],
  resolve: {
    alias: {
      '@insforge/dashboard': dashboardSrcPath,
      '#app': path.resolve(dashboardSrcPath, 'app'),
      '#assets': path.resolve(dashboardSrcPath, 'assets'),
      '#components': path.resolve(dashboardSrcPath, 'components'),
      '#features': path.resolve(dashboardSrcPath, 'features'),
      '#layout': path.resolve(dashboardSrcPath, 'layout'),
      '#lib': path.resolve(dashboardSrcPath, 'lib'),
      '#navigation': path.resolve(dashboardSrcPath, 'navigation'),
      '#router': path.resolve(dashboardSrcPath, 'router'),
      '#types': path.resolve(dashboardSrcPath, 'types'),
      '@insforge/shared-schemas': path.resolve(__dirname, '../packages/shared-schemas/src'),
      '@insforge/ui': path.resolve(__dirname, '../packages/ui/src'),
    },
  },
  server: {
    host: true, // Listen on all interfaces when running in Docker
    port: 7131,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/functions': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/socket.io': {
        target: BACKEND_URL,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist/frontend',
  },
});
