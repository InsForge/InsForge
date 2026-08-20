import { Router } from 'express';
import { paystackRouter } from './paystack/index.routes.js';
import { razorpayRouter } from './razorpay/index.routes.js';
import { stripeRouter } from './stripe/index.routes.js';

const router = Router();

router.use('/stripe', stripeRouter);
router.use('/razorpay', razorpayRouter);
router.use('/paystack', paystackRouter);

export { router as paymentsRouter };
