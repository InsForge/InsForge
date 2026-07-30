import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const configMock = { cloud: { projectId: undefined as string | undefined, apiHost: 'https://x' }, app: { jwtSecret: 's'.repeat(32) } };
vi.mock('../../src/infra/config/app.config', () => ({ config: configMock, appConfig: configMock }));

vi.mock('../../src/api/middlewares/auth', () => ({
  verifyAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const getConfigMock = vi.fn();
const setTokenMock = vi.fn();
vi.mock('../../src/services/webscraper/webscraper.service', () => ({
  WebscraperService: {
    getInstance: () => ({ getApifyConfig: getConfigMock, setApifyToken: setTokenMock }),
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

  it('returns the masked token status', async () => {
    getConfigMock.mockResolvedValue({ token: { configured: true, maskedKey: 'apify_ap••••••••mnop' } });

    const res = await request(app()).get('/webscraper/apify/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: { configured: true, maskedKey: 'apify_ap••••••••mnop' } });
  });

  it('stores a submitted token', async () => {
    setTokenMock.mockResolvedValue({ token: { configured: true, maskedKey: 'apify_ap••••••••mnop' } });

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

    const get = await request(app()).get('/webscraper/apify/config');
    const put = await request(app())
      .put('/webscraper/apify/config')
      .send({ apiToken: 'apify_api_tok1234567890' });

    expect(get.status).toBe(400);
    expect(put.status).toBe(400);
    expect(setTokenMock).not.toHaveBeenCalled();
  });
});
