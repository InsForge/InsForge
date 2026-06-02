import { Router, Response, NextFunction } from 'express';
import { DatabaseAdvanceService } from '@/services/database/database-advance.service.js';
import { DatabaseService } from '@/services/database/database.service.js';
import { AuthService } from '@/services/auth/auth.service.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { FunctionService } from '@/services/functions/function.service.js';
import { RealtimeChannelService } from '@/services/realtime/realtime-channel.service.js';
import { DeploymentService } from '@/services/deployments/deployment.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import {
  ERROR_CODES,
  type AppMetadataSchema,
  type ProjectIdResponse,
} from '@insforge/shared-schemas';
import { SecretService } from '@/services/secrets/secret.service.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { CloudDatabaseProvider } from '@/providers/database/cloud.provider.js';
import { formatContextAsMarkdown } from '@/utils/context-formatter.js';

const router = Router();
const authService = AuthService.getInstance();
const storageService = StorageService.getInstance();
const functionService = FunctionService.getInstance();
const realtimeChannelService = RealtimeChannelService.getInstance();
const dbManager = DatabaseManager.getInstance();
const databaseService = DatabaseService.getInstance();
const dbAdvanceService = DatabaseAdvanceService.getInstance();
const deploymentService = DeploymentService.getInstance();

router.use(verifyAdmin);

// Get full metadata (default endpoint)
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Gather metadata from all modules

    // Fetch all metadata in parallel for better performance
    const [auth, database, storage, functions, deployments] = await Promise.all([
      authService.getMetadata(),
      dbManager.getMetadata(),
      storageService.getMetadata(),
      functionService.getMetadata(),
      deploymentService.getConfigMetadata(),
    ]);

    // Get version from package.json or default
    const version = process.env.npm_package_version || '1.0.0';

    const metadata: AppMetadataSchema = {
      auth,
      database,
      storage,
      functions,
      // Deployments slice is omitted entirely on self-hosted backends
      // (deploymentService.getConfigMetadata returns undefined). Cloud
      // projects see { customSlug: string | null }. The CLI capability
      // probe depends on this presence/absence signal to gate
      // [deployments] TOML sections.
      ...(deployments ? { deployments } : {}),
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

// Structured context export — aggregates all project metadata into a single response
// for AI coding tools and developer onboarding.
// GET /api/metadata/context?format=json (default) or ?format=markdown
router.get('/context', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const format = req.query.format === 'markdown' ? 'markdown' : 'json';
    const schemaName = 'public';

    // Fetch all metadata in parallel from existing services
    const [auth, database, storage, functions, realtime, schemas, indexes, policies, triggers] =
      await Promise.all([
        authService.getMetadata(),
        dbAdvanceService.exportDatabase(undefined, 'json', false, true, false, true),
        storageService.getMetadata(),
        functionService.getMetadata(),
        realtimeChannelService.getMetadata(),
        databaseService.getSchemas(),
        databaseService.getIndexes(schemaName),
        databaseService.getPolicies(schemaName),
        databaseService.getTriggers(schemaName),
      ]);

    const version = process.env.npm_package_version || '1.0.0';
    const exportedAt = new Date().toISOString();

    const dbExport = database.data as {
      tables: Record<string, unknown>;
      functions: unknown[];
      views: unknown[];
    };

    const context = {
      exportedAt,
      version,
      auth,
      database: {
        schemas: schemas.schemas,
        tables: dbExport.tables,
        dbFunctions: dbExport.functions,
        views: dbExport.views,
        indexes: indexes.indexes,
        policies: policies.policies,
        triggers: triggers.triggers,
      },
      storage,
      functions,
      realtime,
    };

    if (format === 'markdown') {
      res
        .set('Content-Type', 'text/markdown; charset=utf-8')
        .send(formatContextAsMarkdown(context));
    } else {
      successResponse(res, context);
    }
  } catch (error) {
    next(error);
  }
});

// get metadata for a table.
// Notice: must be after fixed endpoints like /api-key and /project-id in case of conflict.
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
