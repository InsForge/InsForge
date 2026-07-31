import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const configMock = {
  cloud: { projectId: undefined as string | undefined, apiHost: 'https://x' },
  app: { jwtSecret: 's'.repeat(32) },
};
vi.mock('../../src/infra/config/app.config', () => ({ config: configMock, appConfig: configMock }));

vi.mock('../../src/api/middlewares/auth', () => ({
  verifyAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const setTokenMock = vi.fn();
vi.mock('../../src/services/webscraper/webscraper.service', () => ({
  WebscraperService: {
    getInstance: () => ({ setApifyToken: setTokenMock }),
    isSelfHosted: () => !configMock.cloud.projectId || configMock.cloud.projectId === 'local',
  },
}));

const { webscraperRouter } = await import('../../src/api/routes/webscraper/index.routes');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/webscraper', webscraperRouter);
  a.use(
    (
      err: { statusCode?: number; message?: string },
      _req: unknown,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res: any,
      _next: unknown
    ) => {
      void _next;
      res.status(err.statusCode ?? 500).json({ message: err.message });
    }
  );
  return a;
}

describe('webscraper config routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.cloud.projectId = undefined;
  });

  it('stores a submitted token', async () => {
    setTokenMock.mockResolvedValue({
      token: { configured: true, maskedKey: 'apify_ap••••••••mnop' },
    });

    const res = await request(app())
      .put('/webscraper/apify/config')
      .send({ apiToken: 'apify_api_tok1234567890' });

    expect(res.status).toBe(200);
    expect(setTokenMock).toHaveBeenCalledWith('apify_api_tok1234567890');
  });

  it('rejects an empty token with 400', async () => {
    const res = await request(app()).put('/webscraper/apify/config').send({ apiToken: '   ' });

    expect(res.status).toBe(400);
    expect(setTokenMock).not.toHaveBeenCalled();
  });

  it('refuses config routes on cloud projects', async () => {
    configMock.cloud.projectId = '77777777-7777-7777-7777-777777777777';

    const put = await request(app())
      .put('/webscraper/apify/config')
      .send({ apiToken: 'apify_api_tok1234567890' });

    expect(put.status).toBe(400);
    expect(setTokenMock).not.toHaveBeenCalled();
  });
});

describe('webscraper route wiring', () => {
  async function describeRoutes() {
    const { webscraperRouter } = await import('../../src/api/routes/webscraper/index.routes');
    // Each method registers its own layer, even when two share a path, so every
    // layer carries its own handler stack and has to be inspected separately.
    return (
      webscraperRouter as unknown as {
        stack: Array<{
          route?: {
            path: string;
            methods: Record<string, boolean>;
            stack: Array<{ handle: { name: string } }>;
          };
        }>;
      }
    ).stack
      .flatMap((layer) => (layer.route ? [layer.route] : []))
      .map((route) => ({
        id: `${Object.keys(route.methods)
          .filter((method) => route.methods[method])
          .map((method) => method.toUpperCase())
          .sort()
          .join('/')} ${route.path}`,
        handlers: route.stack.map((handler) => handler.handle.name),
      }));
  }

  // Every route here reads or writes the project's Apify data, and /apify/token
  // hands back a live credential — none may be reachable with an anon key. The
  // assertion covers the whole router rather than just the config route, so a
  // guard dropped from any of them (or a new route added without one) fails.
  it('guards every webscraper route with verifyAdmin', async () => {
    const routes = await describeRoutes();

    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.handlers, `${route.id} is missing verifyAdmin`).toContain('verifyAdmin');
    }
  });

  // Pins the surface itself: without this, deleting a route would silently
  // shrink the loop above to a set that happens to still pass.
  it('registers exactly the documented webscraper routes', async () => {
    const routes = await describeRoutes();

    expect(new Set(routes.map((route) => route.id))).toEqual(
      new Set([
        'GET /apify/connection',
        'DELETE /apify/connection',
        'GET /apify/token',
        'GET /apify/runs',
        'GET /apify/actors',
        'GET /apify/datasets',
        'GET /apify/data',
        'PUT /apify/config',
      ])
    );
  });
});
