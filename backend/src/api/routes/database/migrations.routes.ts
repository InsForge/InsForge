import { Router, Response, NextFunction } from 'express';
import {
  ERROR_CODES,
  createMigrationRequestSchema,
  dryRunMigrationRequestSchema,
  type CreateMigrationResponse,
  type DatabaseMigrationsResponse,
} from '@insforge/shared-schemas';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { migrationsDryRunLimiter } from '@/api/middlewares/rate-limiters.js';
import { AppError } from '@/utils/errors.js';
import { DatabaseMigrationService } from '@/services/database/database-migration.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { successResponse } from '@/utils/response.js';
import { type DatabaseResourceUpdate } from '@/utils/sql-parser.js';
import { dashboardEventService } from '@/services/dashboard/dashboard-event.service.js';

const router = Router();
const migrationService = DatabaseMigrationService.getInstance();
const auditService = AuditService.getInstance();

router.get(
  '/',
  verifyAdmin,
  async (_req: AuthRequest, res: Response<DatabaseMigrationsResponse>, next: NextFunction) => {
    try {
      const response = await migrationService.listMigrations();
      successResponse(res, response);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/',
  verifyAdmin,
  async (req: AuthRequest, res: Response<CreateMigrationResponse>, next: NextFunction) => {
    try {
      const validation = createMigrationRequestSchema.safeParse(req.body);
      if (!validation.success) {
        const issues = validation.error.issues;
        throw new AppError(
          issues.length === 1
            ? issues[0]?.message || 'Invalid migration request.'
            : issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const result = await migrationService.createMigration(validation.data);

      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'CREATE_CUSTOM_MIGRATION',
        module: 'DATABASE',
        details: {
          name: result.migration.name,
          version: result.migration.version,
          statementCount: result.migration.statements.length,
        },
        ip_address: req.ip,
      });

      dashboardEventService.publishDataUpdate({
        resource: 'database',
        data: {
          changes: [{ type: 'migration' }, ...result.changes] as DatabaseResourceUpdate[],
        },
      });

      successResponse(res, result.migration, 201);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/dry-run',
  verifyAdmin,
  migrationsDryRunLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = dryRunMigrationRequestSchema.safeParse(req.body);
      if (!validation.success) {
        const issues = validation.error.issues;
        throw new AppError(
          issues.length === 1
            ? issues[0]?.message || 'Invalid dry-run request.'
            : issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const result = await migrationService.dryRunMigration(validation.data);
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

export { router as databaseMigrationsRouter };
