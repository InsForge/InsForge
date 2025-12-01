import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { RealtimeMessageService } from '@/services/realtime/realtime-message.service.js';
import { successResponse } from '@/utils/response.js';

const router = Router();
const messageService = RealtimeMessageService.getInstance();

// List messages
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { channelId, eventName, limit, offset } = req.query;
    const messages = await messageService.list({
      channelId: channelId as string,
      eventName: eventName as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });
    successResponse(res, messages);
  } catch (error) {
    next(error);
  }
});

// Get message statistics
router.get('/stats', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { channelId, since } = req.query;
    const stats = await messageService.getStats({
      channelId: channelId as string,
      since: since ? new Date(since as string) : undefined,
    });
    successResponse(res, stats);
  } catch (error) {
    next(error);
  }
});

export { router as messagesRouter };
