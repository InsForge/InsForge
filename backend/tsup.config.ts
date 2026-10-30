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
  // Exception — `lru-cache`: our SigV4 verifier's hot-path cache. A devDep
  // transitive pins the older v5 at the root, so the workspace copy nests
  // under backend/node_modules/ instead of hoisting. The Docker runner only
  // ships the hoisted root node_modules/, so bundle lru-cache in rather than
  // teaching the Dockerfile to merge nested module layers.
  //
  // NOTE: `file-type` is intentionally NOT bundled. It hoists cleanly to the
  // root node_modules/ (shipped by the runner), so it resolves at runtime as
  // a normal external. Bundling it inlined its transitive `debug` (via
  // `@tokenizer/inflate`), whose `require('tty')` breaks under esbuild's ESM
  // `__require` shim — keep it external and let Node load it natively.
  noExternal: [/@insforge\/shared-schemas/, 'lru-cache'],
  esbuildOptions(options) {
    options.alias = {
      '@': './src',
    };
  },
});
