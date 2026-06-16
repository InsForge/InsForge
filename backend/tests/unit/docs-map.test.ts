import { describe, it } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve repo root: tests/unit is 3 levels inside the repo (backend/tests/unit)
const repoRoot = path.resolve(__dirname, '../../..');
const docsRoot = path.join(repoRoot, 'docs');
const agentDocsRoot = path.join(repoRoot, '.agents', 'docs');

// Mirror of AGENT_DOCS_MAP in index.routes.ts
const AGENT_DOCS_MAP: Record<string, string> = {
  instructions: 'insforge-instructions-sdk.md',
  'real-time': 'real-time.md',
  deployment: 'deployment.md',
  payments: 'payments.md',
};

// Mirror of LEGACY_DOCS_MAP in index.routes.ts
const LEGACY_DOCS_MAP: Record<string, string> = {
  'db-sdk': 'sdks/typescript/database.mdx',
  'auth-sdk': 'sdks/typescript/auth.mdx',
  'storage-sdk': 'sdks/typescript/storage.mdx',
  'functions-sdk': 'sdks/typescript/functions.mdx',
  'ai-integration-sdk': 'sdks/typescript/ai.mdx',
};

// Mirror of SDK_DOCS_MAP in index.routes.ts
const SDK_DOCS_MAP: Record<string, Record<string, string>> = {
  db: {
    typescript: 'sdks/typescript/database.mdx',
    swift: 'sdks/swift/database.mdx',
    kotlin: 'sdks/kotlin/database.mdx',
    'rest-api': 'sdks/rest/database.mdx',
  },
  storage: {
    typescript: 'sdks/typescript/storage.mdx',
    swift: 'sdks/swift/storage.mdx',
    kotlin: 'sdks/kotlin/storage.mdx',
    'rest-api': 'sdks/rest/storage.mdx',
  },
  functions: {
    typescript: 'sdks/typescript/functions.mdx',
    swift: 'sdks/swift/functions.mdx',
    kotlin: 'sdks/kotlin/functions.mdx',
    'rest-api': 'sdks/rest/functions.mdx',
  },
  auth: {
    typescript: 'sdks/typescript/auth.mdx',
    swift: 'sdks/swift/auth.mdx',
    kotlin: 'sdks/kotlin/auth.mdx',
    'rest-api': 'sdks/rest/auth.mdx',
  },
  ai: {
    typescript: 'sdks/typescript/ai.mdx',
    swift: 'sdks/swift/ai.mdx',
    kotlin: 'sdks/kotlin/ai.mdx',
    'rest-api': 'sdks/rest/ai.mdx',
  },
  realtime: {
    typescript: 'sdks/typescript/realtime.mdx',
    swift: 'sdks/swift/realtime.mdx',
    kotlin: 'sdks/kotlin/realtime.mdx',
    'rest-api': 'sdks/rest/realtime.mdx',
  },
  payments: {
    typescript: 'sdks/typescript/payments.mdx',
  },
};

describe('docs-map file existence', () => {
  describe('AGENT_DOCS_MAP — files must exist in .agents/docs/', () => {
    for (const [key, filename] of Object.entries(AGENT_DOCS_MAP)) {
      it(`${key} → .agents/docs/${filename}`, () => {
        const fullPath = path.join(agentDocsRoot, filename);
        if (!existsSync(fullPath)) {
          throw new Error(
            `AGENT_DOCS_MAP["${key}"] points to "${filename}" but .agents/docs/${filename} does not exist. ` +
              `Did you move the file without updating the map?`
          );
        }
      });
    }
  });

  describe('LEGACY_DOCS_MAP — files must exist in docs/', () => {
    for (const [key, filename] of Object.entries(LEGACY_DOCS_MAP)) {
      it(`${key} → docs/${filename}`, () => {
        const fullPath = path.join(docsRoot, filename);
        if (!existsSync(fullPath)) {
          throw new Error(
            `LEGACY_DOCS_MAP["${key}"] points to "${filename}" but docs/${filename} does not exist. ` +
              `Did you move the file without updating the map?`
          );
        }
      });
    }
  });

  describe('SDK_DOCS_MAP — files must exist in docs/', () => {
    for (const [feature, languages] of Object.entries(SDK_DOCS_MAP)) {
      for (const [language, filename] of Object.entries(languages)) {
        it(`${feature}/${language} → docs/${filename}`, () => {
          const fullPath = path.join(docsRoot, filename);
          if (!existsSync(fullPath)) {
            throw new Error(
              `SDK_DOCS_MAP["${feature}"]["${language}"] points to "${filename}" but docs/${filename} does not exist. ` +
                `Did you move the file without updating the map?`
            );
          }
        });
      }
    }
  });
});
