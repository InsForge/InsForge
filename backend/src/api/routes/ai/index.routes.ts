import { Router, Response, NextFunction } from 'express';
import { ChatCompletionService } from '@/services/ai/chat-completion.service.js';
import { AuthRequest, verifyAdmin, verifyUser } from '../../middlewares/auth.js';
import { ImageGenerationService } from '@/services/ai/image-generation.service.js';
import { EmbeddingService } from '@/services/ai/embedding.service.js';
import { AIModelService } from '@/services/ai/ai-model.service.js';
import { AIUsageService } from '@/services/ai/ai-usage.service.js';
import { AppError } from '@/utils/errors.js';
import { errorResponse, successResponse } from '@/utils/response.js';
import { OpenRouterProvider } from '@/providers/ai/openrouter.provider.js';
import logger from '@/utils/logger.js';
import {
  ERROR_CODES,
  chatCompletionRequestSchema,
  embeddingsRequestSchema,
  imageGenerationRequestSchema,
  usageReportQuerySchema,
  updateQuotaConfigRequestSchema,
} from '@insforge/shared-schemas';
import {
  aiChatRateLimiter,
  aiImageRateLimiter,
  aiEmbeddingRateLimiter,
} from '../../middlewares/rate-limiters.js';

const router = Router();
const chatService = ChatCompletionService.getInstance();
const aiUsageService = AIUsageService.getInstance();
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

/**
 * POST /api/ai/:provider/api-key/rotate
 * Rotate the active provider API key for cloud-managed Model Gateway credentials.
 */
router.post(
  '/:provider/api-key/rotate',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const provider = parseAIProvider(req.params.provider);
      const openRouterProvider = OpenRouterProvider.getInstance();
      const key = await rotateProviderApiKey(provider, openRouterProvider);
      successResponse(res, key);
    } catch (error) {
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

function rotateProviderApiKey(provider: AIProvider, openRouterProvider: OpenRouterProvider) {
  switch (provider) {
    case 'openrouter':
      return openRouterProvider.rotateManagedApiKey();
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
 * Middleware that checks AI quota for the authenticated user.
 * Must run after verifyUser so req.user is populated.
 */
async function checkAIQuota(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      return next(
        new AppError('Authentication required', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS)
      );
    }

    const model = req.body?.model || req.params?.model;
    if (model) {
      await aiUsageService.checkQuota(req.user.id, model);
    }
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/ai/chat/completion
 * Send a chat message to any supported model
 */
router.post(
  '/chat/completion',
  verifyUser,
  aiChatRateLimiter,
  checkAIQuota,
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
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        try {
          const streamGenerator = chatService.streamChat(messages, options);
          let finalPromptTokens = 0;
          let finalCompletionTokens = 0;

          for await (const data of streamGenerator) {
            if (data.chunk) {
              res.write(`data: ${JSON.stringify({ chunk: data.chunk })}\n\n`);
            }
            if (data.tokenUsage) {
              res.write(`data: ${JSON.stringify({ tokenUsage: data.tokenUsage })}\n\n`);
              if (data.tokenUsage.promptTokens) {
                finalPromptTokens = data.tokenUsage.promptTokens;
              }
              if (data.tokenUsage.completionTokens) {
                finalCompletionTokens = data.tokenUsage.completionTokens;
              }
            }
            if (data.tool_calls) {
              res.write(`data: ${JSON.stringify({ tool_calls: data.tool_calls })}\n\n`);
            }
            if (data.annotations) {
              res.write(`data: ${JSON.stringify({ annotations: data.annotations })}\n\n`);
            }
          }

          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);

          if (req.user) {
            aiUsageService.logUsage(
              req.user.id,
              options.model,
              finalPromptTokens,
              finalCompletionTokens,
              'chat'
            ).catch((error) => {
              logger.warn('Failed to log streaming chat usage', { error: String(error) });
            });
          }
        } catch (streamError) {
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

      // Log usage after successful completion
      if (req.user) {
        const usage = result.metadata?.usage;
        aiUsageService.logUsage(
          req.user.id,
          options.model,
          usage?.promptTokens || 0,
          usage?.completionTokens || 0,
          'chat'
        ).catch((error) => {
          logger.warn('Failed to log chat usage', { error: String(error) });
        });
      }

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
  aiImageRateLimiter,
  checkAIQuota,
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

      // Log usage after successful generation
      if (req.user) {
        const usage = result.metadata?.usage;
        aiUsageService.logUsage(
          req.user.id,
          validationResult.data.model,
          usage?.promptTokens || 0,
          usage?.completionTokens || 0,
          'image'
        ).catch((error) => {
          logger.warn('Failed to log image generation usage', { error: String(error) });
        });
      }

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
  aiEmbeddingRateLimiter,
  checkAIQuota,
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

      // Log usage after successful embedding
      if (req.user) {
        const usage = result.metadata?.usage;
        aiUsageService.logUsage(
          req.user.id,
          validationResult.data.model,
          usage?.promptTokens || 0,
          0,
          'embedding'
        ).catch((error) => {
          logger.warn('Failed to log embedding usage', { error: String(error) });
        });
      }

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

/**
 * GET /api/ai/usage/report
 * Get aggregated AI usage report. Admin-only.
 */
router.get(
  '/usage/report',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const queryValidation = usageReportQuerySchema.safeParse(req.query);
      if (!queryValidation.success) {
        throw new AppError(
          `Validation error: ${queryValidation.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { period, userId, model, limit, offset } = queryValidation.data;
      const report = await aiUsageService.getUsageReport(period, userId, model, limit, offset);
      successResponse(res, report);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/ai/quotas
 * Get all quota configs, or a specific user's quota. Admin-only.
 */
router.get(
  '/quotas',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.query.userId as string | undefined;
      const configs = await aiUsageService.getQuotaConfig(userId);
      successResponse(res, configs);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/ai/quotas
 * Create or update a quota config for a user (or global default). Admin-only.
 */
router.put(
  '/quotas',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = updateQuotaConfigRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          `Validation error: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const targetUserId = (req.body.userId as string | null) ?? null;
      const config = await aiUsageService.upsertQuotaConfig(targetUserId, validationResult.data);
      successResponse(res, config);
    } catch (error) {
      next(error);
    }
  }
);

export { router as aiRouter };
