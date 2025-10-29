import { Router } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { successResponse, errorResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Define available documentation files
const DOCS_MAP: Record<string, string> = {
  instructions: 'insforge-instructions-sdk.md',
  'db-sdk': 'core-concepts/database/sdk.mdx',
  'auth-sdk': 'core-concepts/authentication/sdk.mdx',
  'storage-sdk': 'core-concepts/storage/sdk.mdx',
  'functions-sdk': 'core-concepts/functions/sdk.mdx',
  'ai-integration-sdk': 'core-concepts/ai/sdk.mdx',
};

// GET /api/docs/:docType - Get specific documentation
router.get('/:docType', async (req, res, next) => {
  try {
    const { docType } = req.params;

    // Validate doc type
    const docFileName = DOCS_MAP[docType];
    if (!docFileName) {
      return errorResponse(res, ERROR_CODES.NOT_FOUND, 'Documentation not found', 404);
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
      return errorResponse(res, ERROR_CODES.NOT_FOUND, 'Documentation file not found', 404);
    }
    next(error);
  }
});

// GET /api/docs - List available documentation
router.get('/', (_req, res) => {
  const available = Object.keys(DOCS_MAP).map((key) => ({
    type: key,
    filename: DOCS_MAP[key],
    endpoint: `/api/docs/${key}`,
  }));

  // Traditional REST: return list directly
  return successResponse(res, available);
});

export { router as docsRouter };
