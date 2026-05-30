import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { LEGACY_DOCS_MAP, SDK_DOCS_MAP } from '@/api/routes/docs/index.routes.js';

describe('Documentation Maps', () => {
  const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
  const docsRoot = path.join(projectRoot, 'docs');

  it('resolves all legacy docs map paths to existing files', () => {
    for (const [key, docFileName] of Object.entries(LEGACY_DOCS_MAP)) {
      const filePath = path.join(docsRoot, docFileName);
      const exists = fs.existsSync(filePath);
      expect(exists, `Expected file for legacy doc type '${key}' to exist at: ${filePath}`).toBe(true);
    }
  });

  it('resolves all sdk docs map paths to existing files', () => {
    for (const [feature, languages] of Object.entries(SDK_DOCS_MAP)) {
      for (const [language, docFileName] of Object.entries(languages)) {
        if (docFileName) {
          const filePath = path.join(docsRoot, docFileName);
          const exists = fs.existsSync(filePath);
          expect(exists, `Expected file for SDK doc feature '${feature}' language '${language}' to exist at: ${filePath}`).toBe(true);
        }
      }
    }
  });
});
