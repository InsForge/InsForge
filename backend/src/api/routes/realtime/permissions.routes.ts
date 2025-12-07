import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { RealtimeChannelService } from '@/services/realtime/realtime-channel.service.js';
import { successResponse } from '@/utils/response.js';

const router = Router();
const channelService = RealtimeChannelService.getInstance();

// Get realtime RLS permissions (subscribe on channels, publish on messages)
router.get('/', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const permissions = await channelService.getPermissions();
    successResponse(res, permissions);
  } catch (error) {
    next(error);
  }
});

export { router as permissionsRouter };
