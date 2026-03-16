import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { DatabaseWebhookService } from '@/services/database/database-webhook.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import {
  createDatabaseWebhookRequestSchema,
  updateDatabaseWebhookRequestSchema,
  listDatabaseWebhookLogsRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const webhookService = DatabaseWebhookService.getInstance();

/**
 * GET /api/database/webhooks
 * List all database webhooks
 */
router.get('/', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const webhooks = await webhookService.list();
    successResponse(res, webhooks);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/database/webhooks/:id
 * Get a single webhook by ID
 */
router.get('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const webhook = await webhookService.getById(req.params.id);
    if (!webhook) {
      throw new AppError('Webhook not found', 404, ERROR_CODES.NOT_FOUND);
    }
    successResponse(res, webhook);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/database/webhooks
 * Create a new database webhook
 */
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = createDatabaseWebhookRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const webhook = await webhookService.create(validation.data);
    successResponse(res, webhook, 201);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/database/webhooks/:id
 * Update a webhook (url, events, secret, enabled)
 */
router.patch('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = updateDatabaseWebhookRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const webhook = await webhookService.update(req.params.id, validation.data);
    successResponse(res, webhook);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/database/webhooks/:id
 * Delete a webhook and its PostgreSQL trigger
 */
router.delete('/:id', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await webhookService.delete(req.params.id);
    successResponse(res, { message: 'Webhook deleted' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/database/webhooks/:id/logs
 * Get delivery log for a webhook
 */
router.get(
  '/:id/logs',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = listDatabaseWebhookLogsRequestSchema.safeParse(req.query);
      if (!validation.success) {
        throw new AppError('Invalid query parameters', 400, ERROR_CODES.INVALID_INPUT);
      }

      const { limit, offset } = validation.data;
      const logs = await webhookService.getLogs(req.params.id, parseInt(limit), parseInt(offset));
      successResponse(res, logs);
    } catch (error) {
      next(error);
    }
  }
);

export { router as databaseWebhooksRouter };
