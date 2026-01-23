import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';
import { MemoryService } from '@/services/memory/memory.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  storeConversationRequestSchema,
  searchConversationsRequestSchema,
  searchMessagesRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const memoryService = MemoryService.getInstance();

// All memory routes require admin/API key authentication
router.use(verifyAdmin);

// Default userId for API key operations (can be overridden in request body)
const DEFAULT_USER_ID = 'system';

/**
 * POST /api/memory/conversations
 * Store a new conversation with messages
 */
router.post(
  '/conversations',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = storeConversationRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      // Use userId from body, or JWT user, or default to 'system'
      const userId = req.body?.userId || req.user?.id || DEFAULT_USER_ID;

      const result = await memoryService.storeConversation(userId, validation.data);
      successResponse(
        res,
        {
          id: result.id,
          title: result.title,
          messageCount: result.messageCount,
          message: 'Conversation stored successfully',
        },
        201
      );
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/memory/conversations/:id
 * Get a conversation with all its messages
 */
router.get(
  '/conversations/:id',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = (req.query?.userId as string) || req.user?.id || DEFAULT_USER_ID;

      const conversation = await memoryService.getConversation(userId, id);
      if (!conversation) {
        throw new AppError('Conversation not found', 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(res, conversation);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/memory/conversations/:id
 * Delete a conversation and all its messages
 */
router.delete(
  '/conversations/:id',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = (req.query?.userId as string) || req.user?.id || DEFAULT_USER_ID;

      await memoryService.deleteConversation(userId, id);
      successResponse(res, { message: 'Conversation deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/memory/search
 * Search conversations by semantic similarity
 */
router.post('/search', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = searchConversationsRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const userId = req.body?.userId || req.user?.id || DEFAULT_USER_ID;
    const results = await memoryService.searchConversations(userId, validation.data);
    successResponse(res, results);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memory/search/messages
 * Search messages by semantic similarity
 */
router.post(
  '/search/messages',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = searchMessagesRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const userId = req.body?.userId || req.user?.id || DEFAULT_USER_ID;
      const results = await memoryService.searchMessages(userId, validation.data);
      successResponse(res, results);
    } catch (error) {
      next(error);
    }
  }
);

export { router as memoryRouter };
