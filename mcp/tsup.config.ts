import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  banner: {
    js: '#!/usr/bin/env node',
  },
  noExternal: ['@insforge/shared-schemas'],
  external: ['@modelcontextprotocol/sdk', 'commander', 'node-fetch', 'zod'],
  clean: true,
});
