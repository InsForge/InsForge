import { Router, Response, NextFunction } from 'express';
import { channelsRouter } from './channels.routes.js';
import { messagesRouter } from './messages.routes.js';
import { permissionsRouter } from './permissions.routes.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { RealtimeMessageService } from '@/services/realtime/realtime-message.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

const router = Router();
const messageService = RealtimeMessageService.getInstance();

router.use('/channels', channelsRouter);
router.use('/messages', messagesRouter);
router.use('/permissions', permissionsRouter);

// Get retention config
router.get('/config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const retentionDays = await messageService.getRetentionDays();
    successResponse(res, { retentionDays });
  } catch (error) {
    next(error);
  }
});

// Update retention config
router.post('/config', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { retentionDays } = req.body;
    // Handle both null (Never) and positive number
    if (retentionDays !== null && (typeof retentionDays !== 'number' || retentionDays <= 0)) {
      throw new AppError(
        'retentionDays must be a positive number or null',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    await messageService.updateRetentionDays(retentionDays);
    successResponse(res, { message: 'Retention config updated successfully' });
  } catch (error) {
    next(error);
  }
});

export { router as realtimeRouter };
