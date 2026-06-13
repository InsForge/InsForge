import { z } from 'zod';
import { Router, Response, NextFunction } from 'express';
import { DatabaseAdvanceService } from '@/services/database/database-advance.service.js';
import { AuthService } from '@/services/auth/auth.service.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { FunctionService } from '@/services/functions/function.service.js';
import { RealtimeChannelService } from '@/services/realtime/realtime-channel.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import {
  ERROR_CODES,
  type AnonKeyResponse,
  type ProjectIdResponse,
} from '@insforge/shared-schemas';
import { SecretService } from '@/services/secrets/secret.service.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { CloudDatabaseProvider } from '@/providers/database/cloud.provider.js';
import { MetadataService } from '@/services/metadata/metadata.service.js';

const router = Router();
const authService = AuthService.getInstance();
const storageService = StorageService.getInstance();
const functionService = FunctionService.getInstance();
const realtimeChannelService = RealtimeChannelService.getInstance();
const dbManager = DatabaseManager.getInstance();
const dbAdvanceService = DatabaseAdvanceService.getInstance();
const metadataService = MetadataService.getInstance();

router.use(verifyAdmin);

const metadataQuerySchema = z.object({
  format: z.enum(['json', 'markdown']).optional().default('json'),
});

// Get full metadata (default endpoint)
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const queryValidation = metadataQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
      throw new AppError('Invalid format parameter', 400, ERROR_CODES.INVALID_INPUT);
    }
    const { format } = queryValidation.data;

    const metadata = await metadataService.getAppMetadata();

    if (format === 'markdown') {
      res
        .set('Content-Type', 'text/markdown; charset=utf-8')
        .send(metadataService.formatAsMarkdown(metadata));
    } else {
      successResponse(res, metadata);
    }
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

// Get anon key (admin only)
// Opaque, non-secret client identifier (`anon_...`) that maps requests to the
// `anon` role. Safe to embed in frontend bundles; RLS is the security boundary.
// Seeded at startup by seedBackend(), so it always exists here.
router.get('/anon-key', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const secretService = SecretService.getInstance();
    const anonKey = await secretService.getSecretByKey('ANON_KEY');

    if (!anonKey) {
      throw new AppError('Anon key not initialized', 404, ERROR_CODES.SECRET_NOT_FOUND);
    }

    const response: AnonKeyResponse = { anonKey };
    successResponse(res, response);
  } catch (error) {
    next(error);
  }
});

// Get backend project id from environment (admin only)
router.get('/project-id', (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const projectIdResponse: ProjectIdResponse = {
      projectId: process.env.PROJECT_ID || null,
    };
    successResponse(res, projectIdResponse);
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
// Notice: must be after fixed endpoints like /api-key, /anon-key, and /project-id in case of conflict.
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
