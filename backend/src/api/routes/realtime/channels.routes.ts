import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { RealtimeChannelService } from '@/services/realtime/realtime-channel.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { createChannelRequestSchema, updateChannelRequestSchema } from '@insforge/shared-schemas';

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
      throw new AppError('Channel not found', 404, ERROR_CODES.NOT_FOUND);
    }
    successResponse(res, channel);
  } catch (error) {
    next(error);
  }
});

// Create a channel
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = createChannelRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const channel = await channelService.create(validation.data);
    successResponse(res, channel, 201);
  } catch (error) {
    next(error);
  }
});

// Update a channel
router.put('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = updateChannelRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const channel = await channelService.update(req.params.id, validation.data);
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
