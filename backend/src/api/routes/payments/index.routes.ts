import { Router } from 'express';
import { razorpayRouter } from './razorpay/index.routes.js';
import { stripeRouter } from './stripe/index.routes.js';

const router = Router();

router.use('/stripe', stripeRouter);
router.use('/razorpay', razorpayRouter);

export { router as paymentsRouter };
