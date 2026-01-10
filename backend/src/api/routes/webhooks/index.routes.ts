import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { DeploymentService } from '@/services/deployments/deployment.service.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  VERCEL_EVENT_TO_STATUS,
  type VercelWebhookPayload,
  type VercelDeploymentEventType,
} from '@/types/webhooks.js';
import logger from '@/utils/logger.js';

const router = Router();
const deploymentService = DeploymentService.getInstance();
const secretService = SecretService.getInstance();

/**
 * Vercel webhook endpoint
 * POST /api/webhooks/vercel
 *
 * Receives deployment events from Vercel and updates the database accordingly.
 * Verifies the request using HMAC-SHA1 signature in x-vercel-signature header.
 */
router.post('/vercel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signature = req.headers['x-vercel-signature'] as string | undefined;

    if (!signature) {
      throw new AppError('Missing x-vercel-signature header', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    // Get the webhook secret from secrets service
    const webhookSecret = await secretService.getSecretByKey('VERCEL_WEBHOOK_SECRET');

    if (!webhookSecret) {
      logger.error('VERCEL_WEBHOOK_SECRET not found in secrets');
      throw new AppError('Webhook not configured', 500, ERROR_CODES.INTERNAL_ERROR);
    }

    // req.body is raw Buffer (express.raw middleware applied in server.ts)
    const rawBody = req.body as Buffer;

    // Verify the signature using HMAC-SHA1 on original bytes
    const expectedSignature = crypto
      .createHmac('sha1', webhookSecret)
      .update(rawBody)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      logger.warn('Invalid Vercel webhook signature');
      throw new AppError('Invalid signature', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    // Parse the webhook payload after signature verification
    const webhookPayload = JSON.parse(rawBody.toString()) as VercelWebhookPayload;
    const eventType = webhookPayload.type;

    // Check if this is a deployment event we handle
    if (!(eventType in VERCEL_EVENT_TO_STATUS)) {
      logger.info('Ignoring unhandled Vercel webhook event', { eventType });
      return res.status(200).json({ received: true, handled: false });
    }

    const status = VERCEL_EVENT_TO_STATUS[eventType as VercelDeploymentEventType];
    const deploymentId = webhookPayload.payload.deployment.id;
    const url = webhookPayload.payload.deployment.url
      ? `https://${webhookPayload.payload.deployment.url}`
      : null;

    // Update the deployment in our database
    const deployment = await deploymentService.updateDeploymentFromWebhook(
      deploymentId,
      status,
      url,
      {
        webhookEventId: webhookPayload.id,
        webhookEventType: eventType,
        target: webhookPayload.payload.target,
        projectId: webhookPayload.payload.project?.id,
      }
    );

    if (!deployment) {
      // Deployment not found in our database - this is ok, might be from another source
      logger.info('Deployment not found for webhook, ignoring', { deploymentId });
      return res.status(200).json({ received: true, handled: false });
    }

    logger.info('Vercel webhook processed successfully', {
      eventType,
      deploymentId,
      status,
    });

    res.status(200).json({ received: true, handled: true });
  } catch (error) {
    next(error);
  }
});

export { router as webhooksRouter };
