import { Router, Response, NextFunction } from 'express';
import { DatabaseAdvanceService } from '@/services/database/database-advance.service.js';
import { AuthService } from '@/services/auth/auth.service.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { AIConfigService } from '@/services/ai/ai-config.service.js';
import { FunctionService } from '@/services/functions/function.service.js';
import { RealtimeChannelService } from '@/services/realtime/realtime-channel.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { AppError } from '@/api/middlewares/error.js';
import type { AppMetadataSchema } from '@insforge/shared-schemas';
import { SecretService } from '@/services/secrets/secret.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { CloudDatabaseProvider } from '@/providers/database/cloud.provider.js';

const router = Router();
const authService = AuthService.getInstance();
const storageService = StorageService.getInstance();
const functionService = FunctionService.getInstance();
const realtimeChannelService = RealtimeChannelService.getInstance();
const dbManager = DatabaseManager.getInstance();
const dbAdvanceService = DatabaseAdvanceService.getInstance();
const aiConfigService = AIConfigService.getInstance();

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

// Get realtime metadata
router.get('/realtime', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const realtimeMetadata = await realtimeChannelService.getMetadata();
    successResponse(res, realtimeMetadata);
  } catch (error) {
    next(error);
  }
});

// Get API key (admin only)
router.get('/api-key', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const secretService = SecretService.getInstance();
    const apiKey = await secretService.getSecretByKey('API_KEY');

    successResponse(res, { apiKey: apiKey });
  } catch (error) {
    next(error);
  }
});

// Rotate/Regenerate API key (admin only)
router.post('/api-key/rotate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const secretService = SecretService.getInstance();
    const auditService = AuditService.getInstance();

    // Rotate the API key
    const newApiKey = await secretService.rotateApiKey();

    // Log audit
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'ROTATE_API_KEY',
      module: 'SECRETS',
      details: { key: 'API_KEY' },
      ip_address: req.ip,
    });

    successResponse(
      res,
      {
        success: true,
        message: 'API key has been rotated successfully. The old key will be invalid after 24 hours.',
        apiKey: newApiKey,
      },
      200
    );
  } catch (error) {
    next(error);
  }
});

// Get database connection string from cloud backend (admin only)
router.get(
  '/database-connection-string',
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const cloudDbProvider = CloudDatabaseProvider.getInstance();
      const connectionInfo = await cloudDbProvider.getDatabaseConnectionString();
      successResponse(res, connectionInfo);
    } catch (error) {
      next(error);
    }
  }
);

// Get database password from cloud backend (admin only)
router.get('/database-password', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cloudDbProvider = CloudDatabaseProvider.getInstance();
    const passwordInfo = await cloudDbProvider.getDatabasePassword();
    successResponse(res, passwordInfo);
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
