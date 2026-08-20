import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({ authorized: true }));
const configServiceMock = vi.hoisted(() => ({
  getPaystackStatus: vi.fn(),
  getKeyConfig: vi.fn(),
  setPaystackKeys: vi.fn(),
  removePaystackKeys: vi.fn(),
  getWebhookSetup: vi.fn(),
}));
const transactionServiceMock = vi.hoisted(() => ({}));
const customerServiceMock = vi.hoisted(() => ({}));
const ledgerServiceMock = vi.hoisted(() => ({}));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: (
    req: { user?: { id: string }; hasApiKey?: boolean },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    if (!authMock.authorized) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    req.user = { id: 'admin-1' };
    req.hasApiKey = false;
    next();
  },
  verifyUser: (
    req: { user?: { id: string }; hasApiKey?: boolean },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    if (!authMock.authorized) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    req.user = { id: 'user-1' };
    req.hasApiKey = false;
    next();
  },
}));

vi.mock('../../src/services/payments/paystack/config.service.js', () => ({
  PaystackConfigService: {
    getInstance: () => configServiceMock,
  },
}));

vi.mock('../../src/services/payments/paystack/transaction.service.js', () => ({
  PaystackTransactionService: {
    getInstance: () => transactionServiceMock,
  },
}));

vi.mock('../../src/services/payments/payment-customer.service.js', () => ({
  PaymentCustomerService: {
    getInstance: () => customerServiceMock,
  },
}));

vi.mock('../../src/services/payments/transaction.service.js', () => ({
  PaymentTransactionService: {
    getInstance: () => ledgerServiceMock,
  },
}));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  const statusCode =
    error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  res.status(statusCode).json({
    message: error instanceof Error ? error.message : 'Error',
  });
};

async function createApp() {
  const { paystackRouter } = await import('../../src/api/routes/payments/paystack/index.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/payments/paystack', paystackRouter);
  app.use(errorHandler);
  return app;
}

describe('paystack config routes (behavioral)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    authMock.authorized = true;
    configServiceMock.getPaystackStatus.mockResolvedValue([]);
    configServiceMock.getKeyConfig.mockResolvedValue([]);
    configServiceMock.setPaystackKeys.mockResolvedValue(null);
    configServiceMock.removePaystackKeys.mockResolvedValue(true);
    configServiceMock.getWebhookSetup.mockResolvedValue({
      connection: null,
      webhookUrl: 'https://app.example.dev/api/webhooks/paystack/live',
    });
  });

  it('rejects admin-scoped config reads with 401 when the caller is not authorized', async () => {
    authMock.authorized = false;
    const response = await request(await createApp()).get('/api/payments/paystack/config');
    expect(response.status).toBe(401);
    expect(configServiceMock.getKeyConfig).not.toHaveBeenCalled();
  });

  it('returns the environment status connections to admins', async () => {
    const response = await request(await createApp()).get('/api/payments/paystack/status');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ paystackConnections: [] });
    expect(configServiceMock.getPaystackStatus).toHaveBeenCalledTimes(1);
  });

  it('returns the masked key config for both environments', async () => {
    const keys = [
      {
        environment: 'test',
        keyType: 'secret_key',
        value: null,
        hasKey: true,
        maskedKey: 'sk_test_****abcd',
      },
      {
        environment: 'test',
        keyType: 'public_key',
        value: 'pk_test_public',
        hasKey: true,
        maskedKey: null,
      },
    ];
    configServiceMock.getKeyConfig.mockResolvedValue(keys);
    const response = await request(await createApp()).get('/api/payments/paystack/config');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ keys });
  });

  it('stores keys via PUT with the public key passed through unchanged (undefined = keep)', async () => {
    const response = await request(await createApp())
      .put('/api/payments/paystack/live/config')
      .send({ secretKey: 'sk_live_abcdef' });
    expect(response.status).toBe(200);
    expect(configServiceMock.setPaystackKeys).toHaveBeenCalledWith(
      'live',
      'sk_live_abcdef',
      undefined
    );
  });

  it('passes an explicit null public key through so the stored key can be cleared', async () => {
    const response = await request(await createApp())
      .put('/api/payments/paystack/test/config')
      .send({ secretKey: 'sk_test_abcdef', publicKey: null });
    expect(response.status).toBe(200);
    expect(configServiceMock.setPaystackKeys).toHaveBeenCalledWith('test', 'sk_test_abcdef', null);
  });

  it('returns 404 PAYMENT_CONFIG_NOT_FOUND when removing keys that were never configured', async () => {
    configServiceMock.removePaystackKeys.mockResolvedValue(false);
    const response = await request(await createApp()).delete('/api/payments/paystack/test/config');
    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Paystack test keys are not configured');
    expect(configServiceMock.removePaystackKeys).toHaveBeenCalledWith('test');
  });

  it('removes keys and returns the remaining config when keys were active', async () => {
    const remaining = [
      {
        environment: 'live',
        keyType: 'secret_key',
        value: null,
        hasKey: true,
        maskedKey: 'sk_live_****wxyz',
      },
    ];
    configServiceMock.removePaystackKeys.mockResolvedValue(true);
    configServiceMock.getKeyConfig.mockResolvedValue(remaining);
    const response = await request(await createApp()).delete('/api/payments/paystack/live/config');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ keys: remaining });
    expect(configServiceMock.getKeyConfig).toHaveBeenCalledTimes(1);
  });

  it('returns the webhook setup for an environment', async () => {
    const setup = {
      connection: { status: 'connected', environment: 'live', maskedKey: 'sk_live_****wxyz' },
      webhookUrl: 'https://app.example.dev/api/webhooks/paystack/live',
    };
    configServiceMock.getWebhookSetup.mockResolvedValue(setup);
    const response = await request(await createApp()).get('/api/payments/paystack/live/webhook');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(setup);
    expect(configServiceMock.getWebhookSetup).toHaveBeenCalledWith('live');
  });
});
