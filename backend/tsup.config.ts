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
  // Exceptions — deps npm nests under backend/node_modules/ instead of hoisting
  // to the root, so the Docker runner (which only ships the hoisted root
  // node_modules/) can't resolve them at runtime. Inline them into the bundle
  // instead of teaching the Dockerfile to merge nested module layers:
  //   - `lru-cache`: our SigV4 verifier's hot-path cache; a devDep transitive
  //     pins the older v5 at the root so the workspace copy can't hoist.
  //   - `file-type`: used by utils/mime-guard; nests under backend/node_modules
  //     (with its strtok3/token-types deps) alongside the @aws-sdk copies that
  //     pin a newer minor than the root tree.
  noExternal: [/@insforge\/shared-schemas/, 'lru-cache', 'file-type'],
  esbuildOptions(options) {
    options.alias = {
      '@': './src',
    };
  },
});
