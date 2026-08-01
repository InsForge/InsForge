import { Router, Response, NextFunction } from 'express';
import {
  updateDatabaseConfigRequestSchema,
  type GetDatabaseConfigResponse,
  type UpdateDatabaseConfigResponse,
} from '@insforge/shared-schemas';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { parseZodSchema } from '@/utils/zod.js';
import { DatabaseBackupService } from '@/services/database/database-backup.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { successResponse } from '@/utils/response.js';

// Database-module configuration. Scheduled backups are the first section;
// future database-level settings get their own keys alongside `backup`.
const router = Router();
const backupService = DatabaseBackupService.getInstance();
const auditService = AuditService.getInstance();

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
      const payload = parseZodSchema(updateDatabaseConfigRequestSchema, req.body ?? {});
      const backup = await backupService.updateBackupConfig(payload.backup);

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
