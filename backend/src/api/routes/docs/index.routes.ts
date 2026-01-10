import { Router, Request, Response, NextFunction } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { successResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { AppError } from '@/api/middlewares/error.js';
import { DocTypeSchema, docTypeSchema, sdkFeatureSchema, sdkLanguageSchema } from '@insforge/shared-schemas';

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

// Define available documentation files
const DOCS_MAP: Record<DocTypeSchema, string> = {
  // General
  'instructions': 'insforge-instructions-sdk.md',
  // UI Components - Framework-specific
  'auth-components-react': 'sdks/typescript/ui-components/react.mdx',
  'auth-components-nextjs': 'sdks/typescript/ui-components/nextjs.mdx',
  // 'auth-components-react-router': 'core-concepts/authentication/ui-components/react-router.mdx',
  'real-time': 'agent-docs/real-time.md',

  // TypeScript SDK
  'db-sdk-typescript': 'sdks/typescript/database.mdx',
  'storage-sdk-typescript': 'sdks/typescript/storage.mdx',
  'functions-sdk-typescript': 'sdks/typescript/functions.mdx',
  'ai-sdk-typescript': 'sdks/typescript/ai.mdx',
  'auth-sdk-typescript': 'sdks/typescript/auth.mdx',
  'realtime-sdk-typescript': 'sdks/typescript/realtime.mdx',

  // Swift SDK
  'db-sdk-swift': 'sdks/swift/database.mdx',
  'storage-sdk-swift': 'sdks/swift/storage.mdx',
  'auth-sdk-swift': 'sdks/swift/auth.mdx',
  'functions-sdk-swift': 'sdks/swift/functions.mdx',
  'ai-sdk-swift': 'sdks/swift/ai.mdx',
  'realtime-sdk-swift': 'sdks/swift/realtime.mdx',

  // Kotlin SDK
  'db-sdk-kotlin': 'sdks/kotlin/database.mdx',
  'storage-sdk-kotlin': 'sdks/kotlin/storage.mdx',
  'auth-sdk-kotlin': 'sdks/kotlin/auth.mdx',
  'functions-sdk-kotlin': 'sdks/kotlin/functions.mdx',
  'ai-sdk-kotlin': 'sdks/kotlin/ai.mdx',
  'realtime-sdk-kotlin': 'sdks/kotlin/realtime.mdx',

  // Flutter SDK
  // 'db-sdk-flutter': 'sdks/flutter/database.mdx',
  // 'storage-sdk-flutter': 'sdks/flutter/storage.mdx',
  // 'auth-sdk-flutter': 'sdks/flutter/auth.mdx',
  // 'functions-sdk-flutter': 'sdks/flutter/functions.mdx',
  // 'ai-sdk-flutter': 'sdks/flutter/ai.mdx',
  // 'realtime-sdk-flutter': 'sdks/flutter/realtime.mdx',

  // REST API
  'db-rest-api': 'sdks/rest/database.mdx',
  'storage-rest-api': 'sdks/rest/storage.mdx',
  'auth-rest-api': 'sdks/rest/auth.mdx',
  'functions-rest-api': 'sdks/rest/functions.mdx',
  'ai-rest-api': 'sdks/rest/ai.mdx',
  'realtime-rest-api': 'sdks/rest/realtime.mdx',

  // Legacy aliases (for backward compatibility) - map to TypeScript SDK
  'db-sdk': 'sdks/typescript/database.mdx',
  'storage-sdk': 'sdks/typescript/storage.mdx',
  'functions-sdk': 'sdks/typescript/functions.mdx',
  'ai-integration-sdk': 'sdks/typescript/ai.mdx',
  'realtime-sdk': 'sdks/typescript/realtime.mdx',
  'auth-sdk': 'sdks/typescript/auth.mdx',
};

// GET /api/docs/:docType - Get specific documentation
router.get('/:docType', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { docType } = req.params;

    // Validate doc type using Zod enum
    const parsed = docTypeSchema.safeParse(docType);
    if (!parsed.success) {
      throw new AppError('Documentation not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const docFileName = DOCS_MAP[parsed.data];

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

// GET /api/docs/:docFeature/:docLanguage - Get specific documentation
router.get('/:docFeature/:docLanguage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { docFeature, docLanguage } = req.params;

    // Validate doc feature and language using Zod enums
    const parsedFeature = sdkFeatureSchema.safeParse(docFeature);
    const parsedLanguage = sdkLanguageSchema.safeParse(docLanguage);

    if (!parsedFeature.success || !parsedLanguage.success) {
      throw new AppError('Documentation not found', 404, ERROR_CODES.NOT_FOUND);
    }

    // Construct the docType from feature and language
    let docType: string;
    if (parsedLanguage.data === 'rest-api') {
      docType = `${docFeature}-${docLanguage}` as DocTypeSchema;
    } else {
      docType = `${docFeature}-sdk-${docLanguage}` as DocTypeSchema;
    }
    const parsed = docTypeSchema.safeParse(docType);
    if (!parsed.success) {
      throw new AppError('Documentation not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const docFileName = DOCS_MAP[parsed.data];

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
    const available = (Object.keys(DOCS_MAP) as DocTypeSchema[]).map((key) => ({
      type: key,
      filename: DOCS_MAP[key],
      endpoint: `/api/docs/${key}`,
    }));

    // Traditional REST: return list directly
    return successResponse(res, available);
  } catch (error) {
    next(error);
  }
});

export { router as docsRouter };
