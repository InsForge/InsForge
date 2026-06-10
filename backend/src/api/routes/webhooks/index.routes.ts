import { Router } from 'express';
import { razorpayWebhookRouter } from './razorpay.routes.js';
import { stripeWebhookRouter } from './stripe.routes.js';
import { vercelWebhookRouter } from './vercel.routes.js';

const router = Router();

router.use('/stripe', stripeWebhookRouter);
router.use('/razorpay', razorpayWebhookRouter);
router.use('/vercel', vercelWebhookRouter);

export { router as webhooksRouter };
