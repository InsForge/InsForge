import { Router } from 'express';
import { stripeWebhookRouter } from './stripe.routes.js';
import { vercelWebhookRouter } from './vercel.routes.js';

const router = Router();

router.use('/stripe', stripeWebhookRouter);
router.use('/vercel', vercelWebhookRouter);

export { router as webhooksRouter };
