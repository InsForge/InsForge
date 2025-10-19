import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const BACKEND_URL = process.env.VITE_API_BASE_URL || 'http://localhost:7130';

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
