import { Router, Request, Response, NextFunction } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { successResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { AppError } from '@/api/middlewares/error.js';
import { DocTypeSchema, docTypeSchema } from '@insforge/shared-schemas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Define available documentation files
const DOCS_MAP: Record<DocTypeSchema, string> = {
  // General
  instructions: 'insforge-instructions-sdk.md',

  // TypeScript SDK
  'db-sdk-typescript': 'sdks/typescript/database.mdx',
  'storage-sdk-typescript': 'sdks/typescript/storage.mdx',
  'functions-sdk-typescript': 'sdks/typescript/functions.mdx',
  'ai-sdk-typescript': 'sdks/typescript/ai.mdx',
  'auth-sdk-typescript': 'sdks/typescript/auth.mdx',
  'realtime-sdk-typescript': 'sdks/typescript/realtime.mdx',
  'auth-components-react': 'sdks/typescript/ui-components/react.mdx',
  'auth-components-nextjs': 'sdks/typescript/ui-components/nextjs.mdx',

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
  'ai-sdk-kotlin': 'sdks/kotlin/ai.mdx',
  'realtime-sdk-kotlin': 'sdks/kotlin/realtime.mdx',

  // Flutter SDK
  'db-sdk-flutter': 'sdks/flutter/database.mdx',
  'storage-sdk-flutter': 'sdks/flutter/storage.mdx',
  'auth-sdk-flutter': 'sdks/flutter/auth.mdx',
  'ai-sdk-flutter': 'sdks/flutter/ai.mdx',
  'realtime-sdk-flutter': 'sdks/flutter/realtime.mdx',

  // Legacy aliases (for backward compatibility) - map to TypeScript SDK
  'db-sdk': 'sdks/typescript/database.mdx',
  'storage-sdk': 'sdks/typescript/storage.mdx',
  'functions-sdk': 'sdks/typescript/functions.mdx',
  'ai-integration-sdk': 'sdks/typescript/ai.mdx',
  'real-time': 'sdks/typescript/realtime.mdx',
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
    const filePath = path.join(projectRoot, 'docs', docFileName);
    const content = await readFile(filePath, 'utf-8');

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
