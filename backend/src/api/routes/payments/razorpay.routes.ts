import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '@/api/middlewares/auth.js';
import { verifyAdmin } from '@/api/middlewares/auth.js';
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
      await DatabaseManager.getInstance().getPool().query(
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
      const result = results[0]!;

      if (result.status === 'failed') {
        throw new AppError(
          result.error ?? 'Razorpay sync failed',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
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
      const rawBody = JSON.stringify(req.body);
      const isValid = provider.verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        throw new AppError('Invalid Razorpay webhook signature', 400, ERROR_CODES.INVALID_INPUT);
      }

      const payload = req.body as RazorpayWebhookPayload;
      const eventStart = await webhookService.recordWebhookEventStart(environment, payload);

      if (!eventStart.shouldProcess) {
        res.status(200).json({ received: true, handled: false });
        return;
      }

      // Route to specific handlers based on event type
      const handled = await handleRazorpayWebhookEvent(environment, payload);

      const eventId = `${payload.account_id}.${payload.event}.${payload.created_at}`;
      await webhookService.markWebhookEvent(
        environment,
        eventId,
        handled ? 'processed' : 'ignored',
        null
      );

      res.status(200).json({ received: true, handled });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Route Razorpay webhook events to their handlers.
 * On any recognized event we trigger a lightweight re-sync for that environment
 * so the database stays fresh without waiting for the next manual sync.
 */
async function handleRazorpayWebhookEvent(
  environment: RazorpayEnvironment,
  payload: RazorpayWebhookPayload
): Promise<boolean> {
  const { event } = payload;

  const handledEvents = [
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
  ];

  if (!handledEvents.includes(event)) {
    return false;
  }

  // Fire-and-forget a full sync — this keeps all tables up-to-date.
  // The sync service is idempotent and safe to call concurrently.
  syncService.syncAll(environment).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[Razorpay Webhook] Background sync failed for ${environment}: ${message}`);
  });

  return true;
}

export { router as razorpayRouter };
