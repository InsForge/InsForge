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

function normalizeModuleId(id: string) {
  return id.replace(/\\/g, '/');
}

function hasPackage(normalizedId: string, packageName: string) {
  return normalizedId.includes(`/node_modules/${packageName}/`);
}

export function manualChunks(id: string) {
  const normalizedId = normalizeModuleId(id);

  if (!normalizedId.includes('/node_modules/')) {
    return undefined;
  }

  const codemirrorMatch = normalizedId.match(/\/node_modules\/@codemirror\/([^/]+)/);
  if (codemirrorMatch) {
    return editorCorePackages.has(codemirrorMatch[1])
      ? 'vendor-editor-core'
      : `vendor-editor-codemirror-${codemirrorMatch[1]}`;
  }

  const lezerMatch = normalizedId.match(/\/node_modules\/@lezer\/([^/]+)/);
  if (lezerMatch) {
    return lezerCorePackages.has(lezerMatch[1])
      ? 'vendor-editor-core'
      : `vendor-editor-lezer-${lezerMatch[1]}`;
  }

  if (hasPackage(normalizedId, '@uiw/codemirror-theme-vscode')) {
    return 'vendor-editor-theme';
  }

  if (hasPackage(normalizedId, '@uiw/react-codemirror')) {
    return 'vendor-editor-react';
  }

  if (
    hasPackage(normalizedId, '@marijn/find-cluster-break') ||
    hasPackage(normalizedId, 'style-mod') ||
    hasPackage(normalizedId, 'w3c-keyname') ||
    hasPackage(normalizedId, 'crelt')
  ) {
    return 'vendor-editor-core';
  }

  if (
    hasPackage(normalizedId, 'recharts') ||
    hasPackage(normalizedId, 'victory-vendor') ||
    /\/node_modules\/d3-[^/]+\//.test(normalizedId)
  ) {
    return 'vendor-charts';
  }

  if (hasPackage(normalizedId, 'react-data-grid')) {
    return 'vendor-data-grid';
  }

  if (normalizedId.includes('/node_modules/@xyflow/')) {
    return 'vendor-visualizer';
  }

  if (hasPackage(normalizedId, 'posthog-js')) {
    return 'vendor-analytics';
  }

  if (normalizedId.includes('/node_modules/@tanstack/')) {
    return 'vendor-query';
  }

  if (normalizedId.includes('/node_modules/@radix-ui/')) {
    return 'vendor-radix';
  }

  if (hasPackage(normalizedId, 'lucide-react')) {
    return 'vendor-icons';
  }

  if (hasPackage(normalizedId, 'date-fns')) {
    return 'vendor-date';
  }

  if (hasPackage(normalizedId, 'zod')) {
    return 'vendor-validation';
  }

  return 'vendor';
}
