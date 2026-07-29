import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  ERROR_CODES,
  updateDatabaseConfigRequestSchema,
  type GetDatabaseConfigResponse,
  type UpdateDatabaseConfigResponse,
} from '@insforge/shared-schemas';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import { DatabaseBackupService } from '@/services/database/database-backup.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { successResponse } from '@/utils/response.js';

// Database-module configuration. Scheduled backups are the first section;
// future database-level settings get their own keys alongside `backup`.
const router = Router();
const backupService = DatabaseBackupService.getInstance();
const auditService = AuditService.getInstance();

function getValidationMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
}

router.get(
  '/',
  verifyAdmin,
  async (_req: AuthRequest, res: Response<GetDatabaseConfigResponse>, next: NextFunction) => {
    try {
      const backup = await backupService.getBackupConfig();
      successResponse(res, { backup });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/',
  verifyAdmin,
  async (req: AuthRequest, res: Response<UpdateDatabaseConfigResponse>, next: NextFunction) => {
    try {
      const validation = updateDatabaseConfigRequestSchema.safeParse(req.body ?? {});
      if (!validation.success) {
        throw new AppError(getValidationMessage(validation.error), 400, ERROR_CODES.INVALID_INPUT);
      }

      const backup = await backupService.updateBackupConfig(validation.data.backup);

      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'UPDATE_DATABASE_CONFIG',
        module: 'DATABASE',
        details: {
          backup: {
            enabled: backup.enabled,
            cronSchedule: backup.cronSchedule,
            retentionDays: backup.retentionDays,
          },
        },
        ip_address: req.ip,
      });

      successResponse(res, { backup });
    } catch (error) {
      next(error);
    }
  }
);

export { router as databaseConfigRouter };
