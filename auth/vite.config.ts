import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  base: '/auth/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 7132,
    host: true,
    strictPort: false,
    watch: {
      usePolling: true,
    },
  },
  build: {
    outDir: '../dist/auth',
    minify: false, // Keep console.log for debugging
  },
});
