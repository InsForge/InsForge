import { Router, type Response, type NextFunction } from 'express';
import { verifyAdmin, type AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import { successResponse } from '@/utils/response.js';
import { RazorpayConfigService } from '@/services/payments/razorpay-config.service.js';
import { RazorpayWebhookService } from '@/services/payments/razorpay-webhook.service.js';
import { RazorpaySyncService } from '@/services/payments/razorpay-sync.service.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT } from '@/services/payments/constants.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { z } from 'zod';
import type { RazorpayWebhookPayload } from '@/providers/payments/razorpay.provider.js';
import type { RazorpayEnvironment } from '@/types/payments.js';
import logger from '@/utils/logger.js';

const router = Router();
const configService = RazorpayConfigService.getInstance();
const webhookService = RazorpayWebhookService.getInstance();
const syncService = RazorpaySyncService.getInstance();

const razorpayEnvironmentSchema = z.enum(['test', 'live']);

const upsertRazorpayKeysBodySchema = z
  .object({
    keyId: z.string().trim().min(1, 'Razorpay key ID is required'),
    keySecret: z.string().trim().min(1, 'Razorpay key secret is required'),
    webhookSecret: z.string().trim().optional(),
  })
  .strict();

const upsertRazorpayWebhookSecretBodySchema = z
  .object({
    webhookSecret: z.string().trim().min(1, 'Webhook secret is required'),
  })
  .strict();

function getEnvironment(params: unknown): RazorpayEnvironment {
  const env =
    typeof params === 'object' && params !== null && 'environment' in params
      ? (params as { environment: unknown }).environment
      : params;
  const result = razorpayEnvironmentSchema.safeParse(env);
  if (!result.success) {
    throw new AppError('Invalid Razorpay environment', 400, ERROR_CODES.INVALID_INPUT);
  }
  return result.data;
}

// ─── Status: GET /api/payments/razorpay/status ────────────────────────────────
router.get('/status', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const connections = await configService.getRazorpayStatus();
    successResponse(res, { razorpayConnections: connections });
  } catch (error) {
    next(error);
  }
});

// ─── Config: GET /api/payments/razorpay/config ────────────────────────────────
router.get('/config', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const keys = await configService.getKeyConfig();
    successResponse(res, { razorpayKeys: keys });
  } catch (error) {
    next(error);
  }
});

// ─── Upsert Keys: PUT /api/payments/razorpay/:environment/config ──────────────
router.put(
  '/:environment/config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const validation = upsertRazorpayKeysBodySchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      await configService.setRazorpayKeys(
        environment,
        validation.data.keyId,
        validation.data.keySecret,
        validation.data.webhookSecret
      );

      const keys = await configService.getKeyConfig();
      successResponse(res, { razorpayKeys: keys });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Delete Keys: DELETE /api/payments/razorpay/:environment/config ───────────
router.delete(
  '/:environment/config',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const removed = await configService.removeRazorpayKeys(environment);
      if (!removed) {
        throw new AppError(
          'No Razorpay keys configured for this environment',
          404,
          ERROR_CODES.PAYMENT_CONFIG_NOT_FOUND
        );
      }
      const keys = await configService.getKeyConfig();
      successResponse(res, { razorpayKeys: keys });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Upsert Webhook Secret: PUT /api/payments/razorpay/:environment/webhook-secret
router.put(
  '/:environment/webhook-secret',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const validation = upsertRazorpayWebhookSecretBodySchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const secretKey = RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT[environment];
      await DatabaseManager.getInstance()
        .getPool()
        .query(
          `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
         VALUES ($1, $2, true, true)
         ON CONFLICT (key) DO UPDATE SET
           value_ciphertext = EXCLUDED.value_ciphertext,
           is_active        = true,
           is_reserved      = true,
           updated_at       = NOW()`,
          [secretKey, EncryptionManager.encrypt(validation.data.webhookSecret)]
        );

      successResponse(res, { ok: true });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Sync: POST /api/payments/razorpay/:environment/sync ─────────────────────
router.post(
  '/:environment/sync',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const results = await syncService.syncAll(environment);
      const [result] = results;

      if (result.status === 'failed') {
        throw new AppError(result.error ?? 'Razorpay sync failed', 500, ERROR_CODES.INTERNAL_ERROR);
      }

      const connection = await configService.getConnection(environment);
      successResponse(res, {
        connection,
        syncCounts: {
          plans: result.plans,
          items: result.items,
          customers: result.customers,
          subscriptions: result.subscriptions,
          payments: result.payments,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Configure Webhook: POST /api/payments/razorpay/:environment/webhook ──────
router.post(
  '/:environment/webhook-configure',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const provider = await configService.createRazorpayProvider(environment);
      const connection = await configService.configureWebhook(environment, provider);
      successResponse(res, { connection });
    } catch (error) {
      next(error);
    }
  }
);

// ─── Inbound Webhook: POST /api/payments/razorpay/:environment/webhook ────────
// This endpoint receives events FROM Razorpay (no auth middleware — uses signature verification)
router.post(
  '/:environment/webhook',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);

      // Razorpay sends signature in X-Razorpay-Signature header
      const signature = req.headers['x-razorpay-signature'];
      if (!signature || typeof signature !== 'string') {
        throw new AppError('Missing X-Razorpay-Signature header', 400, ERROR_CODES.INVALID_INPUT);
      }

      const webhookSecret = await configService.getRazorpayWebhookSecret(environment);
      if (!webhookSecret) {
        throw new AppError(
          `${RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT[environment]} is not configured`,
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      // Verify signature against the raw body string
      const provider = await configService.createRazorpayProvider(environment);
      const rawBody = ((req as any).rawBody as Buffer).toString('utf8');
      const isValid = provider.verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        throw new AppError('Invalid Razorpay webhook signature', 400, ERROR_CODES.INVALID_INPUT);
      }

      const payload = req.body as RazorpayWebhookPayload;

      const headerEventId = req.headers['x-razorpay-event-id'];
      const entityType = payload.contains?.[0];
      const entityId = entityType
        ? (payload.payload as any)?.[entityType]?.entity?.id
        : 'no_entity';
      const eventId =
        typeof headerEventId === 'string'
          ? headerEventId
          : `${payload.account_id}.${payload.event}.${entityId}.${payload.created_at}`;

      const eventStart = await webhookService.recordWebhookEventStart(
        environment,
        eventId,
        payload.event
      );

      if (!eventStart.shouldProcess) {
        res.status(200).json({ received: true, handled: false });
        return;
      }

      // Determine whether this event type is handled
      const handled = isHandledRazorpayEvent(payload.event);

      if (!handled) {
        await webhookService.markWebhookEvent(environment, eventId, 'ignored', null);
        res.status(200).json({ received: true, handled });
        return;
      }

      // Acknowledge immediately — Razorpay has a 5-second delivery timeout.
      // We leave the event as 'pending' until the background sync finishes.
      res.status(200).json({ received: true, handled });

      // Fire-and-forget: sync runs after the response is sent.
      setImmediate(() => {
        syncService
          .syncAll(environment)
          .then(async (results) => {
            const result = results.find((r) => r.environment === environment);
            if (result && result.status === 'failed') {
              await webhookService.markWebhookEvent(
                environment,
                eventId,
                'failed',
                result.error || 'Sync failed'
              );
            } else {
              await webhookService.markWebhookEvent(environment, eventId, 'processed', null);
            }
          })
          .catch(async (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('[Razorpay Webhook] Background sync failed', {
              environment,
              error: message,
            });
            await webhookService.markWebhookEvent(environment, eventId, 'failed', message);
          });
      });
    } catch (error) {
      next(error);
    }
  }
);

const HANDLED_RAZORPAY_EVENTS = new Set([
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'subscription.created',
  'subscription.activated',
  'subscription.charged',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.paused',
  'subscription.resumed',
  'subscription.halted',
  'refund.created',
  'refund.failed',
  'invoice.paid',
  'invoice.expired',
  'order.paid',
]);

function isHandledRazorpayEvent(event: string): boolean {
  return HANDLED_RAZORPAY_EVENTS.has(event);
}

export { router as razorpayRouter };
