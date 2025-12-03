import { Router, Request, Response, NextFunction } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { successResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { AppError } from '@/api/middlewares/error.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Define available documentation files
const DOCS_MAP: Record<string, string> = {
  instructions: 'insforge-instructions-sdk.md',
  'db-sdk': 'core-concepts/database/sdk.mdx',
  'auth-sdk': 'core-concepts/authentication/sdk.mdx',
  // UI Components - Framework-specific
  'auth-components-react': 'core-concepts/authentication/ui-components/react.mdx',
  'auth-components-nextjs': 'core-concepts/authentication/ui-components/nextjs.mdx',
  'auth-components-react-router': 'core-concepts/authentication/ui-components/react-router.mdx',
  'storage-sdk': 'core-concepts/storage/sdk.mdx',
  'functions-sdk': 'core-concepts/functions/sdk.mdx',
  'ai-integration-sdk': 'core-concepts/ai/sdk.mdx',
  'realtime-sdk': 'core-concepts/realtime/sdk.mdx',
};

// GET /api/docs/:docType - Get specific documentation
router.get('/:docType', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { docType } = req.params;

    // Validate doc type
    const docFileName = DOCS_MAP[docType];
    if (!docFileName) {
      throw new AppError('Documentation not found', 404, ERROR_CODES.NOT_FOUND);
    }

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
    // If file doesn't exist or other error
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      next(new AppError('Documentation file not found', 404, ERROR_CODES.NOT_FOUND));
    } else {
      next(error);
    }
  }
});

// GET /api/docs - List available documentation
router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const available = Object.keys(DOCS_MAP).map((key) => ({
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
