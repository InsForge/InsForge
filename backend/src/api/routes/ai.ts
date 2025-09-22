import { Router, Response, NextFunction } from 'express';
import { ChatService } from '@/core/ai/chat';
import { AuthRequest, verifyAdmin, verifyUser } from '../middleware/auth';
import { ImageService } from '@/core/ai/image';
import { AIModelService } from '@/core/ai/model';
import { AppError } from '@/api/middleware/error';
import { ERROR_CODES } from '@/types/error-constants';
import { successResponse } from '@/utils/response';
import { AIConfigService } from '@/core/ai/config';
import { AIUsageService } from '@/core/ai/usage';
import { AuditService } from '@/core/logs/audit';
import {
  createAIConfigurationRequestSchema,
  updateAIConfigurationRequestSchema,
  getAIUsageRequestSchema,
  getAIUsageSummaryRequestSchema,
  chatCompletionRequestSchema,
  imageGenerationRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const chatService = new ChatService();
const aiConfigService = new AIConfigService();
const aiUsageService = new AIUsageService();
const auditService = AuditService.getInstance();

/**
 * GET /api/ai/models
 * Get all available AI models in ListModelsResponse format
 */
router.get('/models', verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const models = await AIModelService.getModels();
    res.json(models);
  } catch (error) {
    console.error('Error getting models:', error);
    res.status(500).json({
      error: 'Failed to get models list',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

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
          }

          // Send completion signal
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        } catch (streamError) {
          // If error occurs during streaming, send it in SSE format
          console.error('Stream error:', streamError);
          res.write(
            `data: ${JSON.stringify({ error: true, meesage: streamError instanceof Error ? streamError.message : String(streamError) })}\n\n`
          );
        }

        res.end();
        return;
      }

      // Non-streaming requests
      const result = await chatService.chat(messages, options);
      res.json(result);
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

      const result = await ImageService.generate(validationResult.data);

      res.json(result);
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
 * POST /api/ai/configurations
 * Create a new AI configuration
 */
router.post(
  '/configurations',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = createAIConfigurationRequestSchema.safeParse(req.body);

      if (!validationResult.success) {
        throw new AppError(
          `Validation error: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      const { inputModality, outputModality, provider, modelId, systemPrompt } =
        validationResult.data;

      const result = await aiConfigService.create(
        inputModality,
        outputModality,
        provider,
        modelId,
        systemPrompt
      );

      // Log audit for AI configuration creation
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'CREATE_CONFIGURATION',
        module: 'AI',
        details: {
          configId: result.id,
          inputModality,
          outputModality,
          provider,
          modelId,
        },
        ip_address: req.ip,
      });

      successResponse(
        res,
        {
          id: result.id,
          message: 'AI configuration created successfully',
        },
        201
      );
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else {
        next(
          new AppError(
            error instanceof Error ? error.message : 'Failed to create AI configuration',
            500,
            ERROR_CODES.INTERNAL_ERROR
          )
        );
      }
    }
  }
);

/**
 * GET /api/ai/configurations
 * List all AI configurations
 */
router.get(
  '/configurations',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const configurations = await aiConfigService.findAll();

      successResponse(res, configurations);
    } catch (error) {
      next(
        new AppError(
          error instanceof Error ? error.message : 'Failed to fetch AI configurations',
          500,
          ERROR_CODES.INTERNAL_ERROR
        )
      );
    }
  }
);

/**
 * PATCH /api/ai/configurations/:id
 * Update an AI configuration
 */
router.patch(
  '/configurations/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = updateAIConfigurationRequestSchema.safeParse(req.body);

      if (!validationResult.success) {
        throw new AppError(
          `Validation error: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { systemPrompt } = validationResult.data;

      const updated = await aiConfigService.update(req.params.id, systemPrompt);

      if (!updated) {
        throw new AppError('AI configuration not found', 404, ERROR_CODES.NOT_FOUND);
      }

      // Log audit for AI configuration update
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'UPDATE_CONFIGURATION',
        module: 'AI',
        details: {
          configId: req.params.id,
          changes: { systemPrompt },
        },
        ip_address: req.ip,
      });

      successResponse(res, {
        message: 'AI configuration updated successfully',
      });
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else {
        next(
          new AppError(
            error instanceof Error ? error.message : 'Failed to update AI configuration',
            500,
            ERROR_CODES.INTERNAL_ERROR
          )
        );
      }
    }
  }
);

/**
 * DELETE /api/ai/configurations/:id
 * Delete an AI configuration
 */
router.delete(
  '/configurations/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const deleted = await aiConfigService.delete(req.params.id);

      if (!deleted) {
        throw new AppError('AI configuration not found', 404, ERROR_CODES.NOT_FOUND);
      }

      // Log audit for AI configuration deletion
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'DELETE_CONFIGURATION',
        module: 'AI',
        details: {
          configId: req.params.id,
        },
        ip_address: req.ip,
      });

      successResponse(res, {
        message: 'AI configuration deleted successfully',
      });
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else {
        next(
          new AppError(
            error instanceof Error ? error.message : 'Failed to delete AI configuration',
            500,
            ERROR_CODES.INTERNAL_ERROR
          )
        );
      }
    }
  }
);

/**
 * GET /api/ai/usage/summary
 * Get AI usage summary statistics
 */
router.get(
  '/usage/summary',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validationResult = getAIUsageSummaryRequestSchema.safeParse(req.query);

      if (!validationResult.success) {
        throw new AppError(
          `Validation error: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { configId, startDate, endDate } = validationResult.data;

      const summary = await aiUsageService.getUsageSummary(
        configId,
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined
      );

      successResponse(res, summary);
    } catch (error) {
      next(
        new AppError(
          error instanceof Error ? error.message : 'Failed to fetch usage summary',
          500,
          ERROR_CODES.INTERNAL_ERROR
        )
      );
    }
  }
);

/**
 * GET /api/ai/usage
 * Get AI usage records with pagination
 */
router.get('/usage', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validationResult = getAIUsageRequestSchema.safeParse(req.query);

    if (!validationResult.success) {
      throw new AppError(
        `Validation error: ${validationResult.error.errors.map((e) => e.message).join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { startDate, endDate, limit, offset } = validationResult.data;

    const usage = await aiUsageService.getAllUsage(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      parseInt(limit),
      parseInt(offset)
    );

    successResponse(res, usage);
  } catch (error) {
    next(
      new AppError(
        error instanceof Error ? error.message : 'Failed to fetch usage records',
        500,
        ERROR_CODES.INTERNAL_ERROR
      )
    );
  }
});

/**
 * GET /api/ai/usage/config/:configId
 * Get usage records for a specific AI configuration
 */
router.get(
  '/usage/config/:configId',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { startDate, endDate } = req.query;

      const records = await aiUsageService.getUsageByConfig(
        req.params.configId,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );

      successResponse(res, records);
    } catch (error) {
      next(
        new AppError(
          error instanceof Error ? error.message : 'Failed to fetch config usage records',
          500,
          ERROR_CODES.INTERNAL_ERROR
        )
      );
    }
  }
);

export { router as aiRouter };
