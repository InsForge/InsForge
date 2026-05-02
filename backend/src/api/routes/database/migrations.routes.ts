import { Router, Response, NextFunction } from 'express';
import {
  createMigrationRequestSchema,
  type CreateMigrationResponse,
  type DatabaseMigrationsResponse,
} from '@insforge/shared-schemas';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { DatabaseMigrationService } from '@/services/database/database-migration.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { successResponse } from '@/utils/response.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import { type DatabaseResourceUpdate } from '@/utils/sql-parser.js';

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
        actor: req.user?.email || 'api-key',
        action: 'CREATE_CUSTOM_MIGRATION',
        module: 'DATABASE',
        details: {
          name: result.migration.name,
          version: result.migration.version,
          statementCount: result.migration.statements.length,
        },
        ip_address: req.ip,
      });

      const socket = SocketManager.getInstance();
      socket.broadcastToRoom(
        'role:project_admin',
        ServerEvents.DATA_UPDATE,
        {
          resource: DataUpdateResourceType.DATABASE,
          data: {
            changes: [{ type: 'migration' }, ...result.changes] as DatabaseResourceUpdate[],
          },
        },
        'system'
      );

      successResponse(res, result.migration, 201);
    } catch (error) {
      next(error);
    }
  }
);

export { router as databaseMigrationsRouter };
