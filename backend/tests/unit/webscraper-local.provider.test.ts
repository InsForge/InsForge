import { describe, it, expect, vi, beforeEach } from 'vitest';

interface MockAxiosError extends Error {
  __isAxiosError: true;
  response: { status: number; data: unknown };
}

const axiosGetMock = vi.fn();
const axiosIsAxiosError = vi.fn(
  (err: unknown) => (err as { __isAxiosError?: boolean })?.__isAxiosError === true
);

vi.mock('axios', () => ({
  default: { get: axiosGetMock, isAxiosError: axiosIsAxiosError },
}));

function makeAxiosError(status: number): MockAxiosError {
  const err = new Error(`Request failed with status code ${status}`) as MockAxiosError;
  err.__isAxiosError = true;
  err.response = { status, data: { error: { message: 'nope' } } };
  return err;
}

const { LocalWebscraperProvider } = await import('../../src/providers/webscraper/local.provider');

function makeConfig(token: string | null, createdAt = '2026-03-04T05:06:07.000Z') {
  return {
    getToken: vi.fn().mockResolvedValue(token),
    getTokenRecord: vi.fn().mockResolvedValue(token ? { token, createdAt } : null),
    deleteToken: vi.fn().mockResolvedValue(undefined),
  };
}

type ConfigArg = ConstructorParameters<typeof LocalWebscraperProvider>[0];
const provider = (config: ReturnType<typeof makeConfig>) =>
  new LocalWebscraperProvider(config as unknown as ConfigArg);

describe('LocalWebscraperProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no token is configured', async () => {
    const p = provider(makeConfig(null));

    await expect(p.getConnection()).resolves.toBeNull();
    await expect(p.getToken()).resolves.toBeNull();
    await expect(p.getRuns(10)).resolves.toBeNull();
    expect(axiosGetMock).not.toHaveBeenCalled();
  });

  it('maps /users/me into the shared ApifyConnection shape', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        data: {
          id: 'u1',
          username: 'carmen',
          email: 'carmen@example.com',
          plan: { id: 'PERSONAL', tier: 'paid', dataRetentionDays: 30 },
        },
      },
    });
    const p = provider(makeConfig('apify_api_tok1234567890'));

    await expect(p.getConnection()).resolves.toEqual({
      apifyUsername: 'carmen',
      plan: 'PERSONAL',
      planTier: 'paid',
      email: 'carmen@example.com',
      dataRetentionDays: 30,
      status: 'active',
      createdAt: '2026-03-04T05:06:07.000Z',
    });
    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://api.apify.com/v2/users/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer apify_api_tok1234567890' },
      })
    );
  });

  it('reports status revoked when Apify rejects the token', async () => {
    axiosGetMock.mockRejectedValue(makeAxiosError(401));
    const p = provider(makeConfig('apify_api_tok1234567890'));

    const conn = await p.getConnection();

    expect(conn?.status).toBe('revoked');
  });

  it('maps runs with the same fields cloud-backend returns', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        data: {
          items: [
            {
              id: 'run1',
              actId: 'act1',
              status: 'SUCCEEDED',
              startedAt: '2026-03-01T00:00:00.000Z',
              finishedAt: '2026-03-01T00:01:00.000Z',
              usageTotalUsd: 0.02,
              defaultDatasetId: 'ds1',
            },
          ],
        },
      },
    });
    const p = provider(makeConfig('apify_api_tok1234567890'));

    await expect(p.getRuns(10)).resolves.toEqual({
      runs: [
        {
          id: 'run1',
          actId: 'act1',
          status: 'SUCCEEDED',
          startedAt: '2026-03-01T00:00:00.000Z',
          finishedAt: '2026-03-01T00:01:00.000Z',
          usageTotalUsd: 0.02,
          defaultDatasetId: 'ds1',
        },
      ],
    });
    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://api.apify.com/v2/actor-runs?desc=1&limit=10',
      expect.anything()
    );
  });

  it('qualifies actor names with the owner username', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        data: {
          items: [
            {
              id: 'a1',
              name: 'web-scraper',
              username: 'apify',
              title: 'Web Scraper',
              stats: { lastRunStartedAt: '2026-03-01T00:00:00.000Z', totalRuns: 7 },
            },
          ],
        },
      },
    });
    const p = provider(makeConfig('apify_api_tok1234567890'));

    await expect(p.getActors(20)).resolves.toEqual({
      actors: [
        {
          id: 'a1',
          name: 'apify/web-scraper',
          title: 'Web Scraper',
          lastRunStartedAt: '2026-03-01T00:00:00.000Z',
          totalRuns: 7,
        },
      ],
    });
  });

  it('requests unnamed datasets so run output is not hidden', async () => {
    axiosGetMock.mockResolvedValue({ data: { data: { items: [] } } });
    const p = provider(makeConfig('apify_api_tok1234567890'));

    await p.getDatasets(20);

    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://api.apify.com/v2/datasets?desc=1&unnamed=1&limit=20',
      expect.anything()
    );
  });

  it('reads the latest run dataset for the data preview', async () => {
    axiosGetMock
      .mockResolvedValueOnce({
        data: { data: { items: [{ id: 'run1', defaultDatasetId: 'ds1' }] } },
      })
      .mockResolvedValueOnce({ data: [{ title: 'hello' }] });
    const p = provider(makeConfig('apify_api_tok1234567890'));

    await expect(p.getLatestData(5)).resolves.toEqual({
      datasetId: 'ds1',
      items: [{ title: 'hello' }],
    });
    expect(axiosGetMock).toHaveBeenLastCalledWith(
      'https://api.apify.com/v2/datasets/ds1/items?clean=true&limit=5',
      expect.anything()
    );
  });

  it('returns an empty preview when the latest run has no dataset', async () => {
    axiosGetMock.mockResolvedValueOnce({ data: { data: { items: [] } } });
    const p = provider(makeConfig('apify_api_tok1234567890'));

    await expect(p.getLatestData(5)).resolves.toEqual({ datasetId: null, items: [] });
  });

  it('turns an upstream 500 into a 502 AppError', async () => {
    axiosGetMock.mockRejectedValue(makeAxiosError(500));
    const p = provider(makeConfig('apify_api_tok1234567890'));

    await expect(p.getRuns(10)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('rejects an invalid token with a 400 from verifyToken', async () => {
    axiosGetMock.mockRejectedValue(makeAxiosError(401));
    const p = provider(makeConfig(null));

    await expect(p.verifyToken('apify_api_bogus123456789')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('deletes the stored token on disconnect', async () => {
    const config = makeConfig('apify_api_tok1234567890');
    await provider(config).disconnect();

    expect(config.deleteToken).toHaveBeenCalled();
  });
});
