import { Router, Response, NextFunction } from 'express';
import { ChatCompletionService } from '@/services/ai/chat-completion.service.js';
import { AuthRequest, verifyAdmin, verifyUser } from '../../middlewares/auth.js';
import { enforceAIQuota } from '../../middlewares/ai-quota.js';
import { AIUsageService, type AIUsageLogEntry } from '@/services/ai/ai-usage.service.js';
import { AIQuotaService } from '@/services/ai/ai-quota.service.js';
import { ImageGenerationService } from '@/services/ai/image-generation.service.js';
import { EmbeddingService } from '@/services/ai/embedding.service.js';
import { AIModelService } from '@/services/ai/ai-model.service.js';
import { AppError } from '@/utils/errors.js';
import { errorResponse, successResponse } from '@/utils/response.js';
import { OpenRouterProvider } from '@/providers/ai/openrouter.provider.js';
import logger from '@/utils/logger.js';
import {
  ERROR_CODES,
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
 * POST /api/ai/chat/completion
 * Send a chat message to any supported model
 */
router.post(
  '/chat/completion',
  verifyUser,
  enforceAIQuota,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id || 'anonymous';
    const userRole = req.user?.role || 'anon';

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
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokensAccum = 0;

        try {
          const streamGenerator = chatService.streamChat(messages, options);

          for await (const data of streamGenerator) {
            if (data.chunk) {
              res.write(`data: ${JSON.stringify({ chunk: data.chunk })}\n\n`);
            }
            if (data.tokenUsage) {
              // Only emit tokenUsage when actual data arrives (fix: skip all-zero events)
              if (
                data.tokenUsage.promptTokens ||
                data.tokenUsage.completionTokens ||
                data.tokenUsage.totalTokens
              ) {
                totalPromptTokens = data.tokenUsage.promptTokens || 0;
                totalCompletionTokens = data.tokenUsage.completionTokens || 0;
                totalTokensAccum = data.tokenUsage.totalTokens || 0;
                res.write(`data: ${JSON.stringify({ tokenUsage: data.tokenUsage })}\n\n`);
              }
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

          // Log usage after stream completes
          void AIUsageService.getInstance().recordUsage({
            userId,
            userRole,
            model: options.model,
            endpoint: 'chat/completion',
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalTokensAccum,
            estimatedCostUsd: 0,
            status: 'success',
          });
        } catch (streamError) {
          // If error occurs during streaming, send it in SSE format
          logger.error('Stream error during chat completion', {
            error: streamError instanceof Error ? streamError.message : String(streamError),
            stack: streamError instanceof Error ? streamError.stack : undefined,
          });
          res.write(
            `data: ${JSON.stringify({ error: true, message: streamError instanceof Error ? streamError.message : String(streamError) })}\n\n`
          );

          void AIUsageService.getInstance().recordUsage({
            userId,
            userRole,
            model: options.model,
            endpoint: 'chat/completion',
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            status: 'error',
          });
        }

        res.end();
        return;
      }

      // Non-streaming requests
      const result = await chatService.chat(messages, options);

      // Log usage
      void AIUsageService.getInstance().recordUsage({
        userId,
        userRole,
        model: options.model,
        endpoint: 'chat/completion',
        promptTokens: result.metadata?.usage?.promptTokens || 0,
        completionTokens: result.metadata?.usage?.completionTokens || 0,
        totalTokens: result.metadata?.usage?.totalTokens || 0,
        estimatedCostUsd: 0,
        status: 'success',
      });

      successResponse(res, result);
    } catch (error) {
      void AIUsageService.getInstance().recordUsage({
        userId,
        userRole,
        model: req.body?.model || 'unknown',
        endpoint: 'chat/completion',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        status: 'error',
      });

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
  enforceAIQuota,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id || 'anonymous';
    const userRole = req.user?.role || 'anon';

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

      // Log usage
      void AIUsageService.getInstance().recordUsage({
        userId,
        userRole,
        model: validationResult.data.model,
        endpoint: 'image/generation',
        promptTokens: result.metadata?.usage?.promptTokens || 0,
        completionTokens: result.metadata?.usage?.completionTokens || 0,
        totalTokens: result.metadata?.usage?.totalTokens || 0,
        estimatedCostUsd: 0,
        status: 'success',
      });

      successResponse(res, result);
    } catch (error) {
      void AIUsageService.getInstance().recordUsage({
        userId,
        userRole,
        model: req.body?.model || 'unknown',
        endpoint: 'image/generation',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        status: 'error',
      });

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
  enforceAIQuota,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id || 'anonymous';
    const userRole = req.user?.role || 'anon';

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

      // Log usage
      void AIUsageService.getInstance().recordUsage({
        userId,
        userRole,
        model: validationResult.data.model,
        endpoint: 'embeddings',
        promptTokens: result.metadata?.usage?.promptTokens || 0,
        completionTokens: 0,
        totalTokens: result.metadata?.usage?.totalTokens || 0,
        estimatedCostUsd: 0,
        status: 'success',
      });

      successResponse(res, result);
    } catch (error) {
      void AIUsageService.getInstance().recordUsage({
        userId,
        userRole,
        model: req.body?.model || 'unknown',
        endpoint: 'embeddings',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        status: 'error',
      });

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

// ============================================================================
// Admin endpoints — AI Usage & Quota Management
// ============================================================================

/**
 * GET /api/ai/usage/report
 * Get aggregated AI usage report (admin only)
 */
router.get(
  '/usage/report',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { start_date, end_date, limit, offset } = req.query;

      const usageService = AIUsageService.getInstance();
      const report = await usageService.getUsageReport({
        startDate: start_date as string | undefined,
        endDate: end_date as string | undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });

      successResponse(res, report);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/ai/usage/:userId
 * Get usage stats for a specific user (admin only)
 */
router.get(
  '/usage/:userId',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      const usageService = AIUsageService.getInstance();
      const stats = await usageService.getUserStats(userId);
      successResponse(res, stats);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/ai/quotas
 * List all quota configurations (admin only)
 */
router.get(
  '/quotas',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { limit, offset } = req.query;
      const quotaService = AIQuotaService.getInstance();
      const result = await quotaService.listQuotas({
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/ai/quotas/default
 * Get global default quota config (admin only)
 */
router.get(
  '/quotas/default',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const quotaService = AIQuotaService.getInstance();
      const config = await quotaService.getGlobalDefault();
      successResponse(res, config);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/ai/quotas/default
 * Update global default quota config (admin only)
 */
router.put(
  '/quotas/default',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const quotaService = AIQuotaService.getInstance();
      const config = await quotaService.upsertQuota({
        userId: null,
        maxRequestsPerDay: req.body.maxRequestsPerDay,
        maxTokensPerDay: req.body.maxTokensPerDay,
        maxTokensPerMonth: req.body.maxTokensPerMonth,
        maxSpendUsdPerMonth: req.body.maxSpendUsdPerMonth,
        allowedModels: req.body.allowedModels,
        isEnabled: req.body.isEnabled,
      });
      successResponse(res, config);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/ai/quotas/:userId
 * Get quota config for a specific user (admin only)
 */
router.get(
  '/quotas/:userId',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      const quotaService = AIQuotaService.getInstance();
      const config = await quotaService.getUserQuota(userId);
      if (!config) {
        throw new AppError('No quota config found for this user', 404, ERROR_CODES.NOT_FOUND);
      }
      successResponse(res, config);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/ai/quotas/:userId
 * Create or update quota config for a specific user (admin only)
 */
router.put(
  '/quotas/:userId',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      const quotaService = AIQuotaService.getInstance();
      const config = await quotaService.upsertQuota({
        userId,
        maxRequestsPerDay: req.body.maxRequestsPerDay,
        maxTokensPerDay: req.body.maxTokensPerDay,
        maxTokensPerMonth: req.body.maxTokensPerMonth,
        maxSpendUsdPerMonth: req.body.maxSpendUsdPerMonth,
        allowedModels: req.body.allowedModels,
        isEnabled: req.body.isEnabled,
      });
      successResponse(res, config);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/ai/quotas/:userId
 * Delete per-user quota config (reverts to global default) (admin only)
 */
router.delete(
  '/quotas/:userId',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      const quotaService = AIQuotaService.getInstance();
      const deleted = await quotaService.deleteUserQuota(userId);
      if (!deleted) {
        throw new AppError('No quota config found for this user', 404, ERROR_CODES.NOT_FOUND);
      }
      successResponse(res, { success: true, message: 'User quota deleted. Global default applies.' });
    } catch (error) {
      next(error);
    }
  }
);

export { router as aiRouter };
