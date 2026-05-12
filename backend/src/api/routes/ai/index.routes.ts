import { Router, Response, NextFunction } from 'express';
import { ChatCompletionService } from '@/services/ai/chat-completion.service.js';
import { AuthRequest, verifyAdmin, verifyUser } from '../../middlewares/auth.js';
import { ImageGenerationService } from '@/services/ai/image-generation.service.js';
import { EmbeddingService } from '@/services/ai/embedding.service.js';
import { AIModelService } from '@/services/ai/ai-model.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { errorResponse, successResponse } from '@/utils/response.js';
import { OpenRouterProvider } from '@/providers/ai/openrouter.provider.js';
import logger from '@/utils/logger.js';
import {
  chatCompletionRequestSchema,
  embeddingsRequestSchema,
  imageGenerationRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const chatService = ChatCompletionService.getInstance();
type AIProvider = 'openrouter';

/**
 * GET /api/ai/models
 * Get all available AI models in ListModelsResponse format
 */
router.get('/models', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const models = await AIModelService.getModels();
    successResponse(res, models);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ai/overview
 * Get key-level Model Gateway observability from OpenRouter.
 */
router.get(
  '/overview',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const openRouterProvider = OpenRouterProvider.getInstance();
      const overview = await openRouterProvider.getOverview();
      successResponse(res, overview);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/ai/:provider/api-key
 * Get the active provider API key for Model Gateway display/copy.
 */
router.get(
  '/:provider/api-key',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const provider = parseAIProvider(req.params.provider);
      const openRouterProvider = OpenRouterProvider.getInstance();
      const key = await getProviderApiKey(provider, openRouterProvider);
      successResponse(res, key);
    } catch (error) {
      if (error instanceof AppError && error.code === ERROR_CODES.AI_INVALID_API_KEY) {
        errorResponse(
          res,
          ERROR_CODES.AI_INVALID_API_KEY,
          'OpenRouter API key is not configured.',
          400,
          'Set OPENROUTER_API_KEY in the backend environment.'
        );
        return;
      }
      next(error);
    }
  }
);

function parseAIProvider(value: string | undefined): AIProvider {
  if (value === 'openrouter') {
    return value;
  }

  throw new AppError(
    `Unsupported AI provider: ${value || 'unknown'}`,
    400,
    ERROR_CODES.INVALID_INPUT
  );
}

function getProviderApiKey(provider: AIProvider, openRouterProvider: OpenRouterProvider) {
  switch (provider) {
    case 'openrouter':
      return openRouterProvider.getMaskedApiKey();
    default: {
      const exhaustiveProvider: never = provider;
      throw new AppError(
        `Unsupported AI provider: ${exhaustiveProvider}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
  }
}

/**
 * POST /api/ai/chat/completion
 * Send a chat message to any supported model
 */
router.post(
  '/chat/completion',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = chatCompletionRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          `Validation error: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { stream, messages, ...options } = validationResult.data;

      // Handle streaming requests
      if (stream) {
        // Now we know the model is valid, set headers for SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Create and process the stream
        try {
          const streamGenerator = chatService.streamChat(messages, options);

          for await (const data of streamGenerator) {
            if (data.chunk) {
              res.write(`data: ${JSON.stringify({ chunk: data.chunk })}\n\n`);
            }
            if (data.tokenUsage) {
              res.write(`data: ${JSON.stringify({ tokenUsage: data.tokenUsage })}\n\n`);
            }
            if (data.tool_calls) {
              res.write(`data: ${JSON.stringify({ tool_calls: data.tool_calls })}\n\n`);
            }
            if (data.annotations) {
              res.write(`data: ${JSON.stringify({ annotations: data.annotations })}\n\n`);
            }
          }

          // Send completion signal
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        } catch (streamError) {
          // If error occurs during streaming, send it in SSE format
          logger.error('Stream error during chat completion', {
            error: streamError instanceof Error ? streamError.message : String(streamError),
            stack: streamError instanceof Error ? streamError.stack : undefined,
          });
          res.write(
            `data: ${JSON.stringify({ error: true, message: streamError instanceof Error ? streamError.message : String(streamError) })}\n\n`
          );
        }

        res.end();
        return;
      }

      // Non-streaming requests
      const result = await chatService.chat(messages, options);
      successResponse(res, result);
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else {
        next(
          new AppError(
            error instanceof Error ? error.message : 'Failed to generate chat',
            500,
            ERROR_CODES.INTERNAL_ERROR
          )
        );
      }
    }
  }
);

/**
 * POST /api/ai/image/generation
 * Generate images using specified model
 */
router.post(
  '/image/generation',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = imageGenerationRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          `Validation error: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const result = await ImageGenerationService.generate(validationResult.data);

      successResponse(res, result);
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else {
        next(
          new AppError(
            error instanceof Error ? error.message : 'Failed to generate image',
            500,
            ERROR_CODES.INTERNAL_ERROR
          )
        );
      }
    }
  }
);

/**
 * POST /api/ai/embeddings
 * Generate embeddings for text input
 */
router.post(
  '/embeddings',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = embeddingsRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          `Validation error: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const embeddingService = EmbeddingService.getInstance();
      const result = await embeddingService.createEmbeddings(validationResult.data);

      successResponse(res, result);
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else {
        next(
          new AppError(
            error instanceof Error ? error.message : 'Failed to generate embeddings',
            500,
            ERROR_CODES.INTERNAL_ERROR
          )
        );
      }
    }
  }
);

export { router as aiRouter };
