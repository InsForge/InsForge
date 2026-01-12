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

/**
 * Process MDX content to resolve snippet imports and component usage.
 * Only handles imports from the /snippets/ directory for security.
 * Handles patterns like:
 *   import SwiftSdkInstallation from '/snippets/swift-sdk-installation.mdx';
 *   <SwiftSdkInstallation />
 * Non-snippet imports are preserved in the output.
 */
async function processSnippets(content: string, docsRoot: string): Promise<string> {
  // Extract all import statements
  const importRegex = /^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;
  const snippetImports: Map<string, string> = new Map();
  const snippetImportLines: Set<string> = new Set();

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const [fullMatch, componentName, importPath] = match;
    // Only process imports from /snippets/ directory
    if (importPath.startsWith('/snippets/')) {
      snippetImports.set(componentName, importPath);
      snippetImportLines.add(fullMatch);
    }
  }

  // Only remove snippet import lines, preserve other imports
  let processedContent = content;
  for (const importLine of snippetImportLines) {
    processedContent = processedContent.replace(importLine, '');
  }

  // Resolve the allowed snippets directory to an absolute path for security check
  const allowedDir = path.resolve(docsRoot, 'snippets');

  // Replace component usages with actual snippet content
  for (const [componentName, importPath] of snippetImports) {
    // Resolve snippet path
    const snippetPath = path.resolve(docsRoot, importPath.replace(/^\//, ''));

    // Security check: ensure resolved path is strictly inside docsRoot/snippets
    const relativePath = path.relative(allowedDir, snippetPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      console.warn(`Snippet path traversal blocked: ${importPath}`);
      continue;
    }

    try {
      let snippetContent = await readFile(snippetPath, 'utf-8');

      // Remove frontmatter from snippet if present
      snippetContent = snippetContent.replace(/^---[\s\S]*?---\s*/, '');

      // Replace self-closing component tag: <ComponentName />
      const selfClosingRegex = new RegExp(`<${componentName}\\s*/>`, 'g');
      processedContent = processedContent.replace(selfClosingRegex, snippetContent.trim());

      // Replace component with children (if any): <ComponentName>...</ComponentName>
      const withChildrenRegex = new RegExp(
        `<${componentName}\\s*>[\\s\\S]*?</${componentName}>`,
        'g'
      );
      processedContent = processedContent.replace(withChildrenRegex, snippetContent.trim());
    } catch {
      // If snippet file not found, log the import path (not absolute path) and leave component tag as-is
      console.warn(`Snippet not found: ${importPath}`);
    }
  }

  // Clean up extra blank lines
  processedContent = processedContent.replace(/\n{3,}/g, '\n\n');

  return processedContent.trim();
}

// Legacy documentation map for GET /api/docs/:docType endpoint
// Only contains keys defined in DocTypeSchema for type safety
const LEGACY_DOCS_MAP: Record<DocTypeSchema, string> = {
  'instructions': 'insforge-instructions-sdk.md',
  'auth-components-react': 'sdks/typescript/ui-components/react.mdx',
  'auth-components-nextjs': 'sdks/typescript/ui-components/nextjs.mdx',
  'real-time': 'agent-docs/real-time.md',
  'deployment': 'agent-docs/deployment.md',
  // Legacy SDK aliases - map to TypeScript SDK
  'db-sdk': 'sdks/typescript/database.mdx',
  'storage-sdk': 'sdks/typescript/storage.mdx',
  'functions-sdk': 'sdks/typescript/functions.mdx',
  'ai-integration-sdk': 'sdks/typescript/ai.mdx',
  'auth-sdk': 'sdks/typescript/auth.mdx',
};

// SDK documentation map for GET /api/docs/:docFeature/:docLanguage endpoint
// Supports feature × language combinations with type safety
const SDK_DOCS_MAP: Record<SdkFeatureSchema, Partial<Record<SdkLanguageSchema, string>>> = {
  'db': {
    'typescript': 'sdks/typescript/database.mdx',
    'swift': 'sdks/swift/database.mdx',
    'kotlin': 'sdks/kotlin/database.mdx',
    'rest-api': 'sdks/rest/database.mdx',
  },
  'storage': {
    'typescript': 'sdks/typescript/storage.mdx',
    'swift': 'sdks/swift/storage.mdx',
    'kotlin': 'sdks/kotlin/storage.mdx',
    'rest-api': 'sdks/rest/storage.mdx',
  },
  'functions': {
    'typescript': 'sdks/typescript/functions.mdx',
    'swift': 'sdks/swift/functions.mdx',
    'kotlin': 'sdks/kotlin/functions.mdx',
    'rest-api': 'sdks/rest/functions.mdx',
  },
  'auth': {
    'typescript': 'sdks/typescript/auth.mdx',
    'swift': 'sdks/swift/auth.mdx',
    'kotlin': 'sdks/kotlin/auth.mdx',
    'rest-api': 'sdks/rest/auth.mdx',
  },
  'ai': {
    'typescript': 'sdks/typescript/ai.mdx',
    'swift': 'sdks/swift/ai.mdx',
    'kotlin': 'sdks/kotlin/ai.mdx',
    'rest-api': 'sdks/rest/ai.mdx',
  },
  'realtime': {
    'typescript': 'sdks/typescript/realtime.mdx',
    'swift': 'sdks/swift/realtime.mdx',
    'kotlin': 'sdks/kotlin/realtime.mdx',
    'rest-api': 'sdks/rest/realtime.mdx',
  },
};

// GET /api/docs/:docType - Get specific documentation (legacy endpoint)
router.get('/:docType', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { docType } = req.params;

    // Validate doc type using Zod enum
    const parsed = docTypeSchema.safeParse(docType);
    if (!parsed.success) {
      throw new AppError('Documentation not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const docFileName = LEGACY_DOCS_MAP[parsed.data];

    // Read the documentation file
    // PROJECT_ROOT is set in the docker-compose.yml file to point to the InsForge directory
    const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../..');
    const docsRoot = path.join(projectRoot, 'docs');
    const filePath = path.join(docsRoot, docFileName);
    const rawContent = await readFile(filePath, 'utf-8');

    // Process snippet imports and replace component tags with actual content
    const content = await processSnippets(rawContent, docsRoot);

    // Traditional REST: return documentation directly
    return successResponse(res, {
      type: docType,
      content,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/docs/:docFeature/:docLanguage - Get specific SDK documentation
router.get('/:docFeature/:docLanguage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { docFeature, docLanguage } = req.params;

    // Validate doc feature and language using Zod enums
    const parsedFeature = sdkFeatureSchema.safeParse(docFeature);
    const parsedLanguage = sdkLanguageSchema.safeParse(docLanguage);

    if (!parsedFeature.success || !parsedLanguage.success) {
      throw new AppError('Documentation not found', 404, ERROR_CODES.NOT_FOUND);
    }

    // Look up the documentation file from SDK_DOCS_MAP
    const featureDocs = SDK_DOCS_MAP[parsedFeature.data];
    const docFileName = featureDocs[parsedLanguage.data];

    if (!docFileName) {
      throw new AppError('Documentation not found', 404, ERROR_CODES.NOT_FOUND);
    }

    // Construct docType for response
    const docType =
      parsedLanguage.data === 'rest-api'
        ? `${parsedFeature.data}-${parsedLanguage.data}`
        : `${parsedFeature.data}-sdk-${parsedLanguage.data}`;

    // Read the documentation file
    // PROJECT_ROOT is set in the docker-compose.yml file to point to the InsForge directory
    const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../..');
    const docsRoot = path.join(projectRoot, 'docs');
    const filePath = path.join(docsRoot, docFileName);
    const rawContent = await readFile(filePath, 'utf-8');

    // Process snippet imports and replace component tags with actual content
    const content = await processSnippets(rawContent, docsRoot);

    // Traditional REST: return documentation directly
    return successResponse(res, {
      type: docType,
      content,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/docs - List available documentation
router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    // List legacy documentation
    const legacyDocs = (Object.keys(LEGACY_DOCS_MAP) as DocTypeSchema[]).map((key) => ({
      type: key,
      filename: LEGACY_DOCS_MAP[key],
      endpoint: `/api/docs/${key}`,
    }));

    // List SDK documentation (feature × language combinations)
    const sdkDocs: { type: string; filename: string; endpoint: string }[] = [];
    for (const [feature, languages] of Object.entries(SDK_DOCS_MAP)) {
      for (const [language, filename] of Object.entries(languages)) {
        if (filename) {
          const type = language === 'rest-api' ? `${feature}-${language}` : `${feature}-sdk-${language}`;
          sdkDocs.push({
            type,
            filename,
            endpoint: `/api/docs/${feature}/${language}`,
          });
        }
      }
    }

    // Traditional REST: return list directly
    return successResponse(res, [...legacyDocs, ...sdkDocs]);
  } catch (error) {
    next(error);
  }
});

export { router as docsRouter };
