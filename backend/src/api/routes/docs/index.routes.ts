import { Router, Request, Response, NextFunction } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { successResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { AppError } from '@/api/middlewares/error.js';
import {
  DocTypeSchema,
  SdkFeatureSchema,
  SdkLanguageSchema,
  docTypeSchema,
  sdkFeatureSchema,
  sdkLanguageSchema,
} from '@insforge/shared-schemas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

async function processSnippets(content: string, docsRoot: string): Promise<string> {
  const importRegex = /^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;
  const snippetImports: Map<string, string> = new Map();
  const snippetImportLines: Set<string> = new Set();

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const [fullMatch, componentName, importPath] = match;
    if (importPath.startsWith('/snippets/')) {
      snippetImports.set(componentName, importPath);
      snippetImportLines.add(fullMatch);
    }
  }

  let processedContent = content;
  for (const importLine of snippetImportLines) {
    processedContent = processedContent.replace(importLine, '');
  }

  const allowedDir = path.resolve(docsRoot, 'snippets');

  for (const [componentName, importPath] of snippetImports) {
    const snippetPath = path.resolve(docsRoot, importPath.replace(/^\//, ''));

    const relativePath = path.relative(allowedDir, snippetPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      console.warn(`Snippet path traversal blocked: ${importPath}`);
      continue;
    }

    try {
      let snippetContent = await readFile(snippetPath, 'utf-8');
      snippetContent = snippetContent.replace(/^---[\s\S]*?---\s*/, '');

      const selfClosingRegex = new RegExp(`<${componentName}\\s*/>`, 'g');
      processedContent = processedContent.replace(selfClosingRegex, snippetContent.trim());

      const withChildrenRegex = new RegExp(
        `<${componentName}\\s*>[\\s\\S]*?</${componentName}>`,
        'g'
      );
      processedContent = processedContent.replace(withChildrenRegex, snippetContent.trim());
    } catch {
      console.warn(`Snippet not found: ${importPath}`);
    }
  }

  processedContent = processedContent.replace(/\n{3,}/g, '\n\n');
  return processedContent.trim();
}

const LEGACY_DOCS_MAP: Record<DocTypeSchema, string> = {
  instructions: 'insforge-instructions-sdk.md',
  'db-sdk': 'sdks/typescript/database.mdx',
  'auth-sdk': 'sdks/typescript/auth.mdx',
  'storage-sdk': 'sdks/typescript/storage.mdx',
  'functions-sdk': 'sdks/typescript/functions.mdx',
  'ai-integration-sdk': 'sdks/typescript/ai.mdx',
  'real-time': 'agent-docs/real-time.md',
  deployment: 'agent-docs/deployment.md',
};

const SDK_DOCS_MAP: Record<SdkFeatureSchema, Partial<Record<SdkLanguageSchema, string>>> = {
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
};

router.get('/:docType', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { docType } = req.params;

    const parsed = docTypeSchema.safeParse(docType);
    if (!parsed.success) {
      throw new AppError('Documentation not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const docFileName = LEGACY_DOCS_MAP[parsed.data];

    const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../..');
    const docsRoot = path.join(projectRoot, 'docs');
    const filePath = path.join(docsRoot, docFileName);
    const rawContent = await readFile(filePath, 'utf-8');

    const content = await processSnippets(rawContent, docsRoot);

    return successResponse(res, {
      type: docType,
      content,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:docFeature/:docLanguage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { docFeature, docLanguage } = req.params;

    const parsedFeature = sdkFeatureSchema.safeParse(docFeature);
    const parsedLanguage = sdkLanguageSchema.safeParse(docLanguage);

    if (!parsedFeature.success || !parsedLanguage.success) {
      throw new AppError('Documentation not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const featureDocs = SDK_DOCS_MAP[parsedFeature.data];
    const docFileName = featureDocs[parsedLanguage.data];

    if (!docFileName) {
      throw new AppError('Documentation not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const docType =
      parsedLanguage.data === 'rest-api'
        ? `${parsedFeature.data}-${parsedLanguage.data}`
        : `${parsedFeature.data}-sdk-${parsedLanguage.data}`;

    const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../..');
    const docsRoot = path.join(projectRoot, 'docs');
    const filePath = path.join(docsRoot, docFileName);
    const rawContent = await readFile(filePath, 'utf-8');

    const content = await processSnippets(rawContent, docsRoot);

    return successResponse(res, {
      type: docType,
      content,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const legacyDocs = (Object.keys(LEGACY_DOCS_MAP) as DocTypeSchema[]).map((key) => ({
      type: key,
      filename: LEGACY_DOCS_MAP[key],
      endpoint: `/api/docs/${key}`,
    }));

    const sdkDocs: { type: string; filename: string; endpoint: string }[] = [];

    for (const [feature, languages] of Object.entries(SDK_DOCS_MAP)) {
      for (const [language, filename] of Object.entries(languages)) {
        if (filename) {
          const type =
            language === 'rest-api' ? `${feature}-${language}` : `${feature}-sdk-${language}`;

          sdkDocs.push({
            type,
            filename,
            endpoint: `/api/docs/${feature}/${language}`,
          });
        }
      }
    }

    return successResponse(res, [...legacyDocs, ...sdkDocs]);
  } catch (error) {
    next(error);
  }
});

export { router as docsRouter };
