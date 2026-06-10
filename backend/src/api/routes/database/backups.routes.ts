import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  ERROR_CODES,
  createDatabaseBackupRequestSchema,
  renameDatabaseBackupRequestSchema,
  type CreateDatabaseBackupResponse,
  type DatabaseBackupsResponse,
  type DeleteDatabaseBackupResponse,
  type RestoreDatabaseBackupResponse,
  type UpdateDatabaseBackupResponse,
} from '@insforge/shared-schemas';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import { DatabaseBackupService } from '@/services/database/database-backup.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { successResponse } from '@/utils/response.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import { type DatabaseResourceUpdate } from '@/utils/sql-parser.js';

const router = Router();
const backupService = DatabaseBackupService.getInstance();
const auditService = AuditService.getInstance();
const uuidParamSchema = z.string().uuid();

// 22P02 (invalid uuid text) is not mapped by POSTGRES_ERROR_HANDLERS, so an
// unvalidated :id would surface as a 500 instead of a 400.
function parseBackupId(value: string): string {
  const validation = uuidParamSchema.safeParse(value);
  if (!validation.success) {
    throw new AppError('Invalid backup ID', 400, ERROR_CODES.INVALID_INPUT);
  }
  return validation.data;
}

function getValidationMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
}

router.get(
  '/',
  verifyAdmin,
  async (_req: AuthRequest, res: Response<DatabaseBackupsResponse>, next: NextFunction) => {
    try {
      const response = await backupService.listBackups();
      successResponse(res, response);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/',
  verifyAdmin,
  async (req: AuthRequest, res: Response<CreateDatabaseBackupResponse>, next: NextFunction) => {
    try {
      const validation = createDatabaseBackupRequestSchema.safeParse(req.body ?? {});
      if (!validation.success) {
        throw new AppError(getValidationMessage(validation.error), 400, ERROR_CODES.INVALID_INPUT);
      }

      const actor = req.hasApiKey ? 'api-key' : (req.user?.id ?? null);
      const backup = await backupService.createBackup(validation.data, actor);

      await auditService.log({
        actor: actor ?? undefined,
        action: 'CREATE_DATABASE_BACKUP',
        module: 'DATABASE',
        details: { id: backup.id, name: backup.name },
        ip_address: req.ip,
      });

      successResponse(res, backup, 201);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response<UpdateDatabaseBackupResponse>, next: NextFunction) => {
    try {
      const backupId = parseBackupId(req.params.id);
      const validation = renameDatabaseBackupRequestSchema.safeParse(req.body ?? {});
      if (!validation.success) {
        throw new AppError(getValidationMessage(validation.error), 400, ERROR_CODES.INVALID_INPUT);
      }

      const backup = await backupService.renameBackup(backupId, validation.data.name);

      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'RENAME_DATABASE_BACKUP',
        module: 'DATABASE',
        details: { id: backup.id, name: backup.name },
        ip_address: req.ip,
      });

      successResponse(res, backup);
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response<DeleteDatabaseBackupResponse>, next: NextFunction) => {
    try {
      const backupId = parseBackupId(req.params.id);
      await backupService.deleteBackup(backupId);

      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'DELETE_DATABASE_BACKUP',
        module: 'DATABASE',
        details: { id: backupId },
        ip_address: req.ip,
      });

      successResponse(res, { message: 'Backup deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:id/restore',
  verifyAdmin,
  async (req: AuthRequest, res: Response<RestoreDatabaseBackupResponse>, next: NextFunction) => {
    try {
      const backupId = parseBackupId(req.params.id);
      await backupService.restoreBackup(backupId);

      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'RESTORE_DATABASE_BACKUP',
        module: 'DATABASE',
        details: { id: backupId },
        ip_address: req.ip,
      });

      const socket = SocketManager.getInstance();
      socket.broadcastToRoom(
        'role:project_admin',
        ServerEvents.DATA_UPDATE,
        {
          resource: DataUpdateResourceType.DATABASE,
          data: {
            changes: [{ type: 'tables' }, { type: 'records' }] as DatabaseResourceUpdate[],
          },
        },
        'system'
      );

      successResponse(res, { message: 'Database restored successfully' });
    } catch (error) {
      next(error);
    }
  }
);

export { router as databaseBackupsRouter };
