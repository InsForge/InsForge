import { Router, Response, NextFunction } from 'express';
import { DatabaseAdvanceService } from '@/services/database/database-advance.service.js';
import { AuthService } from '@/services/auth/auth.service.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { AIConfigService } from '@/services/ai/ai-config.service.js';
import { FunctionService } from '@/services/functions/function.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { AppError } from '@/api/middlewares/error.js';
import type { AppMetadataSchema } from '@insforge/shared-schemas';
import { SecretService } from '@/services/secrets/secret.service.js';
import { DatabaseManager } from '@/infra/database/manager.js';

const router = Router();
const authService = AuthService.getInstance();
const storageService = StorageService.getInstance();
const functionService = FunctionService.getInstance();
const dbManager = DatabaseManager.getInstance();
const dbAdvanceService = new DatabaseAdvanceService();
const aiConfigService = new AIConfigService();

router.use(verifyAdmin);

// Get full metadata (default endpoint)
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Gather metadata from all modules

    // Fetch all metadata in parallel for better performance
    const [auth, database, storage, aiConfig, functions] = await Promise.all([
      authService.getMetadata(),
      dbManager.getMetadata(),
      storageService.getMetadata(),
      aiConfigService.getMetadata(),
      functionService.getMetadata(),
    ]);

    // Get version from package.json or default
    const version = process.env.npm_package_version || '1.0.0';

    const metadata: AppMetadataSchema = {
      auth,
      database,
      storage,
      functions,
      aiIntegration: aiConfig,
      version,
    };

    successResponse(res, metadata);
  } catch (error) {
    next(error);
  }
});

// Get auth metadata
router.get('/auth', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authMetadata = await authService.getMetadata();
    successResponse(res, authMetadata);
  } catch (error) {
    next(error);
  }
});

// Get database metadata
router.get('/database', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const databaseMetadata = await dbManager.getMetadata();
    successResponse(res, databaseMetadata);
  } catch (error) {
    next(error);
  }
});

// Get storage metadata
router.get('/storage', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const storageMetadata = await storageService.getMetadata();
    successResponse(res, storageMetadata);
  } catch (error) {
    next(error);
  }
});

// Get AI metadata
router.get('/ai', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const aiMetadata = await aiConfigService.getMetadata();
    successResponse(res, aiMetadata);
  } catch (error) {
    next(error);
  }
});

// Get functions metadata
router.get('/functions', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const functionsMetadata = await functionService.getMetadata();
    successResponse(res, functionsMetadata);
  } catch (error) {
    next(error);
  }
});

// Get API key (admin only)
router.get('/api-key', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const secretService = new SecretService();
    const apiKey = await secretService.getSecretByKey('API_KEY');

    successResponse(res, { apiKey: apiKey });
  } catch (error) {
    next(error);
  }
});

// get metadata for a table.
// Notice: must be after endpoint /api-key in case of conflict.
router.get('/:tableName', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { tableName } = req.params;
    if (!tableName) {
      throw new AppError('Table name is required', 400, ERROR_CODES.INVALID_INPUT);
    }

    const includeData = false;
    const includeFunctions = false;
    const includeSequences = false;
    const includeViews = false;
    const schemaResponse = await dbAdvanceService.exportDatabase(
      [tableName],
      'json',
      includeData,
      includeFunctions,
      includeSequences,
      includeViews
    );

    // When format is 'json', the data contains the tables object
    const jsonData = schemaResponse.data as { tables: Record<string, unknown> };
    const metadata = jsonData.tables;
    successResponse(res, metadata);
  } catch (error) {
    next(error);
  }
});

export { router as metadataRouter };
