import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { RealtimeChannelService } from '@/services/realtime/realtime-channel.service.js';
import { successResponse } from '@/utils/response.js';

const router = Router();
const channelService = RealtimeChannelService.getInstance();

// List all channels
router.get('/', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const channels = await channelService.list();
    successResponse(res, channels);
  } catch (error) {
    next(error);
  }
});

// Get channel by ID
router.get('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const channel = await channelService.getById(req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    successResponse(res, channel);
  } catch (error) {
    next(error);
  }
});

// Create a channel
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const channel = await channelService.create(req.body);
    successResponse(res, channel, 201);
  } catch (error) {
    next(error);
  }
});

// Update a channel
router.put('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const channel = await channelService.update(req.params.id, req.body);
    successResponse(res, channel);
  } catch (error) {
    next(error);
  }
});

// Delete a channel
router.delete('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await channelService.delete(req.params.id);
    successResponse(res, { message: 'Channel deleted' });
  } catch (error) {
    next(error);
  }
});

export { router as channelsRouter };
