import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import tailwindcss from '@tailwindcss/vite';

const dashboardSrcPath = path.resolve(__dirname, 'src');
const editorCorePackages = new Set([
  'autocomplete',
  'commands',
  'language',
  'lint',
  'search',
  'state',
  'view',
]);
const lezerCorePackages = new Set(['common', 'highlight', 'lr']);

function manualChunks(id: string) {
  if (!id.includes('node_modules')) {
    return undefined;
  }

  const normalizedId = id.replaceAll(path.sep, '/');
  const codemirrorMatch = normalizedId.match(/node_modules\/@codemirror\/([^/]+)/);
  if (codemirrorMatch) {
    return editorCorePackages.has(codemirrorMatch[1])
      ? 'vendor-editor-core'
      : `vendor-editor-codemirror-${codemirrorMatch[1]}`;
  }

  const lezerMatch = normalizedId.match(/node_modules\/@lezer\/([^/]+)/);
  if (lezerMatch) {
    return lezerCorePackages.has(lezerMatch[1])
      ? 'vendor-editor-core'
      : `vendor-editor-lezer-${lezerMatch[1]}`;
  }

  if (id.includes('@uiw/codemirror-theme-vscode')) {
    return 'vendor-editor-theme';
  }

  if (id.includes('@uiw/react-codemirror')) {
    return 'vendor-editor-react';
  }

  if (
    id.includes('@marijn/find-cluster-break') ||
    id.includes('style-mod') ||
    id.includes('w3c-keyname') ||
    id.includes('crelt')
  ) {
    return 'vendor-editor-core';
  }

  if (id.includes('recharts') || id.includes('d3-')) {
    return 'vendor-charts';
  }

  if (id.includes('react-data-grid')) {
    return 'vendor-data-grid';
  }

  if (id.includes('@xyflow/')) {
    return 'vendor-visualizer';
  }

  if (id.includes('posthog-js')) {
    return 'vendor-analytics';
  }

  if (id.includes('@tanstack/')) {
    return 'vendor-query';
  }

  if (id.includes('@radix-ui/')) {
    return 'vendor-radix';
  }

  if (id.includes('lucide-react')) {
    return 'vendor-icons';
  }

  if (id.includes('date-fns')) {
    return 'vendor-date';
  }

  if (id.includes('zod')) {
    return 'vendor-validation';
  }

  return 'vendor';
}

export default defineConfig({
  plugins: [react(), tailwindcss(), svgr()],
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
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    cssCodeSplit: false,
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        manualChunks,
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css') ? 'styles.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
