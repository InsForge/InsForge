import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { RealtimeConfigService } from '@/services/realtime/realtime-config.service.js';
import { RealtimeMessageService } from '@/services/realtime/realtime-message.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  listMessagesRequestSchema,
  messageStatsRequestSchema,
  updateRealtimeMessageRetentionRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const messageService = RealtimeMessageService.getInstance();
const configService = RealtimeConfigService.getInstance();
const auditService = AuditService.getInstance();

router.get('/config', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = await configService.getMessageRetentionConfig();
    successResponse(res, config);
  } catch (error) {
    next(error);
  }
});

router.put('/config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = updateRealtimeMessageRetentionRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const config = await configService.updateMessageRetentionConfig(validation.data);

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'UPDATE_REALTIME_MESSAGE_RETENTION',
      module: 'REALTIME',
      details: {
        updatedFields: Object.keys(validation.data),
        enabled: config.enabled,
        retentionDays: config.retentionDays,
      },
      ip_address: req.ip,
    });

    successResponse(res, config);
  } catch (error) {
    next(error);
  }
});

router.post('/cleanup', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deletedCount = await configService.runMessageCleanup();

    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'RUN_REALTIME_MESSAGE_CLEANUP',
      module: 'REALTIME',
      details: { deletedCount },
      ip_address: req.ip,
    });

    successResponse(res, { deletedCount });
  } catch (error) {
    next(error);
  }
});

// List messages
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = listMessagesRequestSchema.safeParse(req.query);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const messages = await messageService.list(validation.data);
    successResponse(res, messages);
  } catch (error) {
    next(error);
  }
});

// Get message statistics
router.get('/stats', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = messageStatsRequestSchema.safeParse(req.query);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const stats = await messageService.getStats(validation.data);
    successResponse(res, stats);
  } catch (error) {
    next(error);
  }
});

export { router as messagesRouter };
