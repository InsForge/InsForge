const fs = require('fs');

// Resolve index.routes.ts
let indexContent = fs.readFileSync(
  'backend/src/api/routes/payments/razorpay/index.routes.ts',
  'utf8'
);
indexContent = indexContent.replace(
  /<<<<<<< HEAD\n=======\nimport { AppError } from '@\/utils\/errors\.js';\n>>>>>>> [^\n]+\n/,
  "import { AppError } from '@/utils/errors.js';\n"
);

indexContent = indexContent.replace(
  /<<<<<<< HEAD\nimport { RazorpayPaymentActivityService } from '@\/services\/payments\/razorpay\/payment-activity\.service\.js';\nimport { RazorpayCheckoutService } from '@\/services\/payments\/razorpay\/checkout\.service\.js';\n=======\n>>>>>>> [^\n]+\n/,
  "import { RazorpayPaymentActivityService } from '@/services/payments/razorpay/payment-activity.service.js';\nimport { RazorpayCheckoutService } from '@/services/payments/razorpay/checkout.service.js';\n"
);

indexContent = indexContent.replace(
  /<<<<<<< HEAD\n  createRazorpayOrderBodySchema,\n  createRazorpaySubscriptionBodySchema,\n=======\n  pauseRazorpaySubscriptionBodySchema,\n  razorpaySubscriptionParamsSchema,\n  resumeRazorpaySubscriptionBodySchema,\n  verifyRazorpayOrderBodySchema,\n  verifyRazorpaySubscriptionBodySchema,\n>>>>>>> [^\n]+\n/,
  '  createRazorpayOrderBodySchema,\n  createRazorpaySubscriptionBodySchema,\n  pauseRazorpaySubscriptionBodySchema,\n  razorpaySubscriptionParamsSchema,\n  resumeRazorpaySubscriptionBodySchema,\n  verifyRazorpayOrderBodySchema,\n  verifyRazorpaySubscriptionBodySchema,\n'
);

indexContent = indexContent.replace(
  /<<<<<<< HEAD\nconst paymentActivityService = RazorpayPaymentActivityService\.getInstance\(\);\nconst checkoutService = RazorpayCheckoutService\.getInstance\(\);\n=======\n>>>>>>> [^\n]+\n/,
  'const paymentActivityService = RazorpayPaymentActivityService.getInstance();\nconst checkoutService = RazorpayCheckoutService.getInstance();\n'
);

indexContent = indexContent.replace(
  /<<<<<<< HEAD\n\/\/ ---------------------------------------------------------------------------\n\/\/ Runtime: POST \/orders  \(one-time payment\)\n\/\/ Requires a valid user token — the developer's server-side SDK calls this on\n\/\/ behalf of the end-user who clicked "Buy"\.\n\/\/ ---------------------------------------------------------------------------\n=======\n>>>>>>> [^\n]+\n/,
  '// ---------------------------------------------------------------------------\n// Runtime: POST /orders  (one-time payment)\n// Requires a valid user token — the developer\'s server-side SDK calls this on\n// behalf of the end-user who clicked "Buy".\n// ---------------------------------------------------------------------------\n'
);

// Fix the big block with orders
const block1 = `<<<<<<< HEAD
      const result = await checkoutService.createOrder({ environment, ...body });
      successResponse(res, result, 201);
=======
      if (!req.user) {
        throw new AppError(
          'Razorpay order creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const order = await orderService.createOrder(
        {
          environment,
          ...body,
        },
        req.user
      );
      successResponse(res, order, 201);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/orders/verify',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(verifyRazorpayOrderBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Razorpay order verification requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await orderService.verifyOrderPayment({
        environment,
        ...body,
      });
      successResponse(res, result);
>>>>>>>`;

const regex1 = new RegExp(block1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' [^\\n]+\\n');
indexContent = indexContent.replace(
  regex1,
  `      if (!req.user) {
        throw new AppError(
          'Razorpay order creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }
      const result = await checkoutService.createOrder({ environment, ...body });
      successResponse(res, result, 201);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/orders/verify',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(verifyRazorpayOrderBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Razorpay order verification requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await orderService.verifyOrderPayment({
        environment,
        ...body,
      });
      successResponse(res, result);
`
);

indexContent = indexContent.replace(
  /<<<<<<< HEAD\n\/\/ ---------------------------------------------------------------------------\n\/\/ Runtime: POST \/subscriptions  \(recurring billing\)\n\/\/ Requires a valid user token\.\n\/\/ ---------------------------------------------------------------------------\n=======\n>>>>>>> [^\n]+\n/,
  '// ---------------------------------------------------------------------------\n// Runtime: POST /subscriptions  (recurring billing)\n// Requires a valid user token.\n// ---------------------------------------------------------------------------\n'
);

// Fix subscriptions block
const block2 = `<<<<<<< HEAD
      const result = await checkoutService.createSubscription({ environment, ...body });
      successResponse(res, result, 201);
=======
      if (!req.user) {
        throw new AppError(
          'Razorpay subscription creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const subscription = await subscriptionService.createSubscription(
        {
          environment,
          ...body,
        },
        req.user
      );
      successResponse(res, subscription, 201);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/verify',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(verifyRazorpaySubscriptionBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription verification requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.verifySubscriptionPayment({
        environment,
        ...body,
      });
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/:subscriptionId/cancel',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(razorpaySubscriptionParamsSchema, req.params);
      const body = parseZodSchema(cancelRazorpaySubscriptionBodySchema, req.body ?? {});

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription cancellation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.cancelSubscription(
        {
          ...params,
          ...body,
        },
        req.user
      );
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/:subscriptionId/pause',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(razorpaySubscriptionParamsSchema, req.params);
      parseZodSchema(pauseRazorpaySubscriptionBodySchema, req.body ?? {});

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription pause requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.pauseSubscription(params, req.user);
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/:subscriptionId/resume',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(razorpaySubscriptionParamsSchema, req.params);
      parseZodSchema(resumeRazorpaySubscriptionBodySchema, req.body ?? {});

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription resume requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.resumeSubscription(params, req.user);
      successResponse(res, result);
>>>>>>>`;
const regex2 = new RegExp(block2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' [^\\n]+\\n');
indexContent = indexContent.replace(
  regex2,
  `      if (!req.user) {
        throw new AppError(
          'Razorpay subscription creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }
      const result = await checkoutService.createSubscription({ environment, ...body });
      successResponse(res, result, 201);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/verify',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(verifyRazorpaySubscriptionBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription verification requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.verifySubscriptionPayment({
        environment,
        ...body,
      });
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/:subscriptionId/cancel',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(razorpaySubscriptionParamsSchema, req.params);
      const body = parseZodSchema(cancelRazorpaySubscriptionBodySchema, req.body ?? {});

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription cancellation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.cancelSubscription(
        {
          ...params,
          ...body,
        },
        req.user
      );
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/:subscriptionId/pause',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(razorpaySubscriptionParamsSchema, req.params);
      parseZodSchema(pauseRazorpaySubscriptionBodySchema, req.body ?? {});

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription pause requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.pauseSubscription(params, req.user);
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/:subscriptionId/resume',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(razorpaySubscriptionParamsSchema, req.params);
      parseZodSchema(resumeRazorpaySubscriptionBodySchema, req.body ?? {});

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription resume requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.resumeSubscription(params, req.user);
      successResponse(res, result);
`
);

indexContent = indexContent.replace(
  /<<<<<<< HEAD\n\/\/ ---------------------------------------------------------------------------\n\/\/ Admin-only routes\n\/\/ ---------------------------------------------------------------------------\n=======\n>>>>>>> [^\n]+\n/,
  '// ---------------------------------------------------------------------------\n// Admin-only routes\n// ---------------------------------------------------------------------------\n'
);

fs.writeFileSync('backend/src/api/routes/payments/razorpay/index.routes.ts', indexContent);

// Resolve packages/shared-schemas/src/payments-api.schema.ts
let schemaContent = fs.readFileSync('packages/shared-schemas/src/payments-api.schema.ts', 'utf8');

// There's a big block from <<<<<<< HEAD ... ======= ... >>>>>>> origin/add-razorpay
// We need to keep the new schemas from HEAD but also keep the types from origin
const schemaBlock = `<<<<<<< HEAD
// ---------------------------------------------------------------------------
// Razorpay Runtime Checkout Schemas
// ---------------------------------------------------------------------------`;

schemaContent = schemaContent.replace(
  /<<<<<<< HEAD[\s\S]*?=======\nexport type SyncStripePaymentsRequest = z\.infer<typeof syncStripePaymentsRequestSchema>;\n>>>>>>> [^\n]+\n/,
  (match) => {
    // Extract everything from HEAD
    const headContent = match.split('=======')[0].replace('<<<<<<< HEAD\n', '');
    return (
      headContent +
      'export type SyncStripePaymentsRequest = z.infer<typeof syncStripePaymentsRequestSchema>;\n'
    );
  }
);

fs.writeFileSync('packages/shared-schemas/src/payments-api.schema.ts', schemaContent);
