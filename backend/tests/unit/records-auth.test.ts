import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const authMocks = vi.hoisted(() => {
  const state: {
    context: {
      user?: { id: string; role: 'anon' | 'authenticated' | 'project_admin' };
      hasApiKey?: boolean;
    };
  } = { context: {} };

  return {
    state,
    verifyUser: vi.fn((req, _res, next) => {
      if ('user' in state.context) {
        req.user = state.context.user;
      }
      if ('hasApiKey' in state.context) {
        req.hasApiKey = state.context.hasApiKey;
      }
      next();
    }),
  };
});

const proxyMocks = vi.hoisted(() => ({
  forward: vi.fn(),
  forwardAsAdmin: vi.fn(),
  filterHeaders: vi.fn((headers: Record<string, unknown>) => headers),
}));

const databaseMocks = vi.hoisted(() => ({
  getColumnTypeMap: vi.fn(),
}));

const socketMocks = vi.hoisted(() => ({
  broadcastToRoom: vi.fn(),
}));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyUser: authMocks.verifyUser,
}));

vi.mock('../../src/services/database/postgrest-proxy.service.js', () => ({
  PostgrestProxyService: {
    getInstance: () => proxyMocks,
    filterHeaders: proxyMocks.filterHeaders,
  },
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getColumnTypeMap: databaseMocks.getColumnTypeMap,
  },
}));

vi.mock('../../src/infra/socket/socket.manager.js', () => ({
  SocketManager: {
    getInstance: () => socketMocks,
  },
}));

const routeErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next;

  const statusCode =
    error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  const message = error instanceof Error ? error.message : 'Internal server error';

  res.status(statusCode).json({ message });
};

async function createApp() {
  vi.resetModules();
  const [{ databaseRecordsRouter }, { databaseRpcRouter }] = await Promise.all([
    import('../../src/api/routes/database/records.routes.js'),
    import('../../src/api/routes/database/rpc.routes.js'),
  ]);

  const app = express();
  app.use(express.json());
  app.use('/api/database/records', databaseRecordsRouter);
  app.use('/api/database/rpc', databaseRpcRouter);
  app.use(routeErrorHandler);
  return app;
}

function mockProxyResponses() {
  proxyMocks.forward.mockResolvedValue({ data: [{ via: 'user' }], status: 200, headers: {} });
  proxyMocks.forwardAsAdmin.mockResolvedValue({
    data: [{ via: 'project_admin' }],
    status: 200,
    headers: {},
  });
}

describe('Database Records Route Authentication', () => {
  beforeEach(() => {
    authMocks.state.context = {};
    databaseMocks.getColumnTypeMap.mockResolvedValue({});
    mockProxyResponses();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('forwards project admin requests as PostgREST admin', async () => {
    authMocks.state.context = {
      user: { id: 'local:admin', role: 'project_admin' },
      hasApiKey: false,
    };
    const app = await createApp();

    await request(app).get('/api/database/records/widgets?select=id').expect(200);

    expect(authMocks.verifyUser).toHaveBeenCalledOnce();
    expect(proxyMocks.forwardAsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/widgets',
        query: expect.objectContaining({ select: 'id' }),
      })
    );
    expect(proxyMocks.forward).not.toHaveBeenCalled();
  });

  test('forwards API key requests as PostgREST admin', async () => {
    authMocks.state.context = { hasApiKey: true };
    const app = await createApp();

    await request(app).get('/api/database/records/widgets?select=id').expect(200);

    expect(authMocks.verifyUser).toHaveBeenCalledOnce();
    expect(proxyMocks.forwardAsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/widgets' })
    );
    expect(proxyMocks.forward).not.toHaveBeenCalled();
  });

  test('forwards normal user requests without admin override', async () => {
    authMocks.state.context = {
      user: { id: 'user-id', role: 'authenticated' },
      hasApiKey: false,
    };
    const app = await createApp();

    await request(app).get('/api/database/records/widgets?select=id').expect(200);

    expect(authMocks.verifyUser).toHaveBeenCalledOnce();
    expect(proxyMocks.forward).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/widgets' })
    );
    expect(proxyMocks.forwardAsAdmin).not.toHaveBeenCalled();
  });
});

describe('Database RPC Route Authentication', () => {
  beforeEach(() => {
    authMocks.state.context = {};
    mockProxyResponses();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('forwards project admin RPC calls as PostgREST admin', async () => {
    authMocks.state.context = {
      user: { id: 'local:admin', role: 'project_admin' },
      hasApiKey: false,
    };
    const app = await createApp();

    await request(app).post('/api/database/rpc/do_work').send({ value: 1 }).expect(200);

    expect(authMocks.verifyUser).toHaveBeenCalledOnce();
    expect(proxyMocks.forwardAsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/rpc/do_work',
        body: { value: 1 },
      })
    );
    expect(proxyMocks.forward).not.toHaveBeenCalled();
  });

  test('forwards API key RPC calls as PostgREST admin', async () => {
    authMocks.state.context = { hasApiKey: true };
    const app = await createApp();

    await request(app).post('/api/database/rpc/do_work').send({ value: 1 }).expect(200);

    expect(authMocks.verifyUser).toHaveBeenCalledOnce();
    expect(proxyMocks.forwardAsAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/rpc/do_work' })
    );
    expect(proxyMocks.forward).not.toHaveBeenCalled();
  });

  test('forwards normal user RPC calls without admin override', async () => {
    authMocks.state.context = {
      user: { id: 'user-id', role: 'authenticated' },
      hasApiKey: false,
    };
    const app = await createApp();

    await request(app).post('/api/database/rpc/do_work').send({ value: 1 }).expect(200);

    expect(authMocks.verifyUser).toHaveBeenCalledOnce();
    expect(proxyMocks.forward).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/rpc/do_work' })
    );
    expect(proxyMocks.forwardAsAdmin).not.toHaveBeenCalled();
  });
});
