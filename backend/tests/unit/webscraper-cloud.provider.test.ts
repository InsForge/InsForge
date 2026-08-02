import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiHost = 'https://cloud.test.insforge.dev';
const projectId = '77777777-7777-7777-7777-777777777777';
const jwtSecret = 's'.repeat(32);

vi.mock('../../src/infra/config/app.config', () => {
  const c = { cloud: { projectId, apiHost }, app: { jwtSecret } };
  return { config: c, appConfig: c };
});

interface MockAxiosError extends Error {
  __isAxiosError: true;
  response: { status: number; data: { error: string } };
}

const axiosGetMock = vi.fn();
const axiosDeleteMock = vi.fn();
const axiosIsAxiosError = vi.fn(
  (err: unknown) => (err as { __isAxiosError?: boolean })?.__isAxiosError === true
);

vi.mock('axios', () => ({
  default: { get: axiosGetMock, delete: axiosDeleteMock, isAxiosError: axiosIsAxiosError },
}));

function makeAxiosError(status: number): MockAxiosError {
  const err = new Error(`Request failed with status code ${status}`) as MockAxiosError;
  err.__isAxiosError = true;
  err.response = { status, data: { error: 'test' } };
  return err;
}

const { CloudWebscraperProvider } = await import('../../src/providers/webscraper/cloud.provider');

describe('CloudWebscraperProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('proxies runs to the cloud-backend project route', async () => {
    axiosGetMock.mockResolvedValue({ data: { runs: [{ id: 'r1' }] } });

    const result = await CloudWebscraperProvider.getInstance().getRuns(10);

    expect(result).toEqual({ runs: [{ id: 'r1' }] });
    expect(axiosGetMock).toHaveBeenCalledWith(
      `${apiHost}/projects/v1/${projectId}/apify/runs`,
      expect.objectContaining({ params: { limit: 10 } })
    );
  });

  it('maps a 404 from cloud-backend to null', async () => {
    axiosGetMock.mockRejectedValue(makeAxiosError(404));

    await expect(CloudWebscraperProvider.getInstance().getConnection()).resolves.toBeNull();
  });
});
