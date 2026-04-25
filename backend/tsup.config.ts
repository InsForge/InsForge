import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: '../dist',
  clean: false, // Don't clean the whole dist folder (frontend is there)
  sourcemap: true,
  // Don't bundle node_modules, only our code and shared-schemas.
  // Exception: `lru-cache` — our SigV4 verifier's hot-path cache. Npm nests
  // it under backend/node_modules/ because a devDep transitive pins the
  // older v5 at the root and the workspace conflict can't be hoisted. The
  // Docker runner only ships the hoisted root node_modules/, so Node can't
  // resolve it at runtime. Inline it into the bundle instead of teaching
  // the Dockerfile to merge nested module layers.
  noExternal: [/@insforge\/shared-schemas/, 'lru-cache'],
  esbuildOptions(options) {
    options.alias = {
      '@': './src',
    };
  },
});
