import { Router, Response, NextFunction } from 'express';
import { ChatCompletionService } from '@/services/ai/chat-completion.service.js';
import { AuthRequest, verifyUser } from '../../middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';

const router = Router();
const chatService = ChatCompletionService.getInstance();

/**
 * POST /api/ai/query
 * Query any AI model through InsForge gateway
 */
router.post('/query', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { model, prompt, options = {} } = req.body;

    if (!model || !prompt) {
      throw new AppError(
        'Missing required fields: model, prompt',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new AppError(
        'prompt must be a non-empty string',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const messages = [{ role: 'user' as const, content: prompt }];

    const result = await chatService.chat(messages, { model, ...options });

    successResponse(res, {
        model,
        content: result.text,
        usage: result.metadata?.usage,
      });
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else {
      next(
        new AppError(
          error instanceof Error ? error.message : 'AI query failed',
          500,
          ERROR_CODES.INTERNAL_ERROR
        )
      );
    }
  }
});

export { router as aiQueryRouter };