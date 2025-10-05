import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss(), svgr()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@insforge/shared-schemas': path.resolve(__dirname, '../shared-schemas/src'),
    },
  },
  server: {
    host: true, // Listen on all interfaces when running in Docker
    port: 7131,
    proxy: {
      '/api': {
        target: 'http://localhost:7130',
        changeOrigin: true,
      },
      '/functions': {
        target: 'http://localhost:7130',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:7130',
        ws: true,
        changeOrigin: true,
      },
    },
    watch: { usePolling: true, interval: 1000 },
  },
  build: {
    outDir: '../dist/frontend',
  },
});
