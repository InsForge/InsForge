import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: '../dist',
  clean: false, // Don't clean the whole dist folder (frontend is there)
  sourcemap: true,
  // Don't bundle node_modules, only our code and shared-schemas
  noExternal: [/@insforge\/shared-schemas/],
  esbuildOptions(options) {
    options.alias = {
      '@': './src',
    };
  },
});
