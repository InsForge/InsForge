import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryServiceMock = vi.hoisted(() => ({
  remember: vi.fn(),
  recall: vi.fn(),
  index: vi.fn(),
  forget: vi.fn(),
}));

const authMock = vi.hoisted(() => ({ hasApiKey: true }));

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

// The memory router mounts verifyApiKey for every route, so the 401 path is the
// middleware's. Drive it from a flag rather than bypassing it, to keep the
// route's auth boundary in the test.
vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyApiKey: (
    req: { authenticated?: boolean; hasApiKey?: boolean },
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void
  ) => {
    if (!authMock.hasApiKey) {
      res.status(401).json({ message: 'No API key provided', code: 'AUTH_INVALID_API_KEY' });
      return;
    }
    req.authenticated = true;
    req.hasApiKey = true;
    next();
  },
}));

vi.mock('../../src/services/memory/memory.service.js', () => ({
  MemoryService: { getInstance: () => memoryServiceMock },
}));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  const statusCode =
    error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;
  res.status(statusCode).json({
    message: error instanceof Error ? error.message : 'Error',
    ...(code ? { code } : {}),
  });
};

async function createApp() {
  const { memoryRouter } = await import('../../src/api/routes/memory/index.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/memory', memoryRouter);
  app.use(errorHandler);
  return app;
}

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('POST /api/memory/forget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.hasApiKey = true;
  });

  it('returns the forgotten ids and passes scope and ids through to the service', async () => {
    memoryServiceMock.forget.mockResolvedValue([ID_A]);
    const app = await createApp();

    const res = await request(app)
      .post('/api/memory/forget')
      .send({ scope: 'proj', ids: [ID_A, ID_B] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ forgotten: [ID_A] });
    expect(memoryServiceMock.forget).toHaveBeenCalledWith({ scope: 'proj', ids: [ID_A, ID_B] });
  });

  it('defaults the scope when the body omits it', async () => {
    memoryServiceMock.forget.mockResolvedValue([]);
    const app = await createApp();

    const res = await request(app)
      .post('/api/memory/forget')
      .send({ ids: [ID_A] });

    expect(res.status).toBe(200);
    expect(memoryServiceMock.forget).toHaveBeenCalledWith({ scope: 'default', ids: [ID_A] });
  });

  it('rejects a non-uuid id with 400 and never reaches the service', async () => {
    const app = await createApp();

    const res = await request(app)
      .post('/api/memory/forget')
      .send({ scope: 'proj', ids: ['not-a-uuid'] });

    expect(res.status).toBe(400);
    expect(memoryServiceMock.forget).not.toHaveBeenCalled();
  });

  it('rejects an empty id list with 400', async () => {
    const app = await createApp();

    const res = await request(app).post('/api/memory/forget').send({ scope: 'proj', ids: [] });

    expect(res.status).toBe(400);
    expect(memoryServiceMock.forget).not.toHaveBeenCalled();
  });

  it('rejects a missing id list with 400', async () => {
    const app = await createApp();

    const res = await request(app).post('/api/memory/forget').send({ scope: 'proj' });

    expect(res.status).toBe(400);
    expect(memoryServiceMock.forget).not.toHaveBeenCalled();
  });

  it('requires an API key', async () => {
    authMock.hasApiKey = false;
    const app = await createApp();

    const res = await request(app)
      .post('/api/memory/forget')
      .send({ ids: [ID_A] });

    expect(res.status).toBe(401);
    expect(memoryServiceMock.forget).not.toHaveBeenCalled();
  });

  it('forwards a service failure to the error handler rather than returning 200', async () => {
    memoryServiceMock.forget.mockRejectedValue(new Error('delete boom'));
    const app = await createApp();

    const res = await request(app)
      .post('/api/memory/forget')
      .send({ ids: [ID_A] });

    expect(res.status).toBe(500);
  });
});
