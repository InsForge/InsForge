import { Router, Response, NextFunction } from 'express';
import { channelsRouter } from './channels.routes.js';
import { messagesRouter } from './messages.routes.js';
import { permissionsRouter } from './permissions.routes.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { RealtimeMessageService } from '@/services/realtime/realtime-message.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  getRealtimeConfigResponseSchema,
  updateRealtimeConfigRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const messageService = RealtimeMessageService.getInstance();

router.use('/channels', channelsRouter);
router.use('/messages', messagesRouter);
router.use('/permissions', permissionsRouter);

// Get realtime config
router.get('/config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = getRealtimeConfigResponseSchema.parse({
      retentionDays: await messageService.getRetentionDays(),
    });
    successResponse(res, config);
  } catch (error) {
    next(error);
  }
});

// Update realtime config
router.patch(
  '/config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = updateRealtimeConfigRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { retentionDays } = validation.data;
      await messageService.updateRetentionDays(retentionDays);
      successResponse(res, { message: 'Retention config updated successfully' });
    } catch (error) {
      next(error);
    }
  }
);

export { router as realtimeRouter };
