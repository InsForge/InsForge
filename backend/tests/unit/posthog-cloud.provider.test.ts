import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { ERROR_CODES } from '../../src/types/error-constants';

const apiHost = 'https://cloud.test.insforge.dev';
const projectId = '77777777-7777-7777-7777-777777777777';
const jwtSecret = 's'.repeat(32);

vi.mock('../../src/infra/config/app.config', () => ({
  config: {
    cloud: { projectId, apiHost },
    app: { jwtSecret },
  },
}));

interface MockAxiosError extends Error {
  __isAxiosError: true;
  response: { status: number; data: { error: string } };
}

// Axios mock factory — must be hoisted
const axiosGetMock = vi.fn();
const axiosDeleteMock = vi.fn();
const axiosIsAxiosError = vi.fn((err: unknown) => {
  return (err as { __isAxiosError?: boolean })?.__isAxiosError === true;
});

vi.mock('axios', () => {
  return {
    default: {
      get: axiosGetMock,
      delete: axiosDeleteMock,
      isAxiosError: axiosIsAxiosError,
    },
  };
});

function makeAxiosError(status: number): MockAxiosError {
  const err = new Error(`Request failed with status code ${status}`) as MockAxiosError;
  err.__isAxiosError = true;
  err.response = { status, data: { error: 'test' } };
  return err;
}

// Import after mocks are set up
const { CloudPosthogProvider } = await import('../../src/providers/posthog/cloud.provider');

describe('CloudPosthogProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton for each test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (CloudPosthogProvider as any).instance = undefined;
  });

  describe('getConnection', () => {
    it('signs JWT with projectId as sub and parses response', async () => {
      const responseData = {
        posthogProjectId: '12345',
        organizationName: 'Org',
        projectName: 'P',
        region: 'US',
        host: 'https://us.posthog.com',
        apiKey: 'phc_pub',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
      };

      axiosGetMock.mockResolvedValueOnce({ data: responseData });

      const out = await CloudPosthogProvider.getInstance().getConnection();
      expect(out).not.toBeNull();
      expect(out!.posthogProjectId).toEqual('12345');
      expect(out!.apiKey).toEqual('phc_pub');

      // Verify the Authorization header was sent with a valid JWT
      const callArgs = axiosGetMock.mock.calls[0];
      const headers = callArgs[1].headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Bearer /);
      const token = headers.Authorization.slice(7);
      const decoded = jwt.verify(token, jwtSecret) as jwt.JwtPayload;
      expect(decoded.sub).toEqual(projectId);
    });

    it('returns null on 404', async () => {
      axiosGetMock.mockRejectedValueOnce(makeAxiosError(404));

      const out = await CloudPosthogProvider.getInstance().getConnection();
      expect(out).toBeNull();
    });

    it('throws AppError with UPSTREAM_FAILURE on 502', async () => {
      axiosGetMock.mockRejectedValueOnce(makeAxiosError(502));

      await expect(CloudPosthogProvider.getInstance().getConnection()).rejects.toMatchObject({
        statusCode: 502,
        code: ERROR_CODES.UPSTREAM_FAILURE,
      });
    });
  });

  describe('getDashboards', () => {
    it('throws AppError with NOT_FOUND on 404', async () => {
      axiosGetMock.mockRejectedValueOnce(makeAxiosError(404));

      await expect(CloudPosthogProvider.getInstance().getDashboards()).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.NOT_FOUND,
      });
    });

    it('throws AppError with UPSTREAM_FAILURE on network error', async () => {
      axiosGetMock.mockRejectedValueOnce(new Error('Network Error'));

      await expect(CloudPosthogProvider.getInstance().getDashboards()).rejects.toMatchObject({
        statusCode: 502,
        code: ERROR_CODES.UPSTREAM_FAILURE,
      });
    });

    it('parses dashboards response', async () => {
      const responseData = {
        dashboards: [
          {
            id: 1,
            name: 'Main Dashboard',
            url: 'https://us.posthog.com/dashboard/1',
          },
        ],
        count: 1,
      };
      axiosGetMock.mockResolvedValueOnce({ data: responseData });

      const out = await CloudPosthogProvider.getInstance().getDashboards();
      expect(out.count).toEqual(1);
      expect(out.dashboards).toHaveLength(1);
      expect(out.dashboards[0].name).toEqual('Main Dashboard');
    });
  });

  describe('getSummary', () => {
    it('parses summary response', async () => {
      axiosGetMock.mockResolvedValueOnce({
        data: {
          todayEvents: 1234,
          dau24h: 56,
          totalEvents7d: 8000,
          topEvents: [{ event: 'pageview', count: 500 }],
        },
      });
      const out = await CloudPosthogProvider.getInstance().getSummary();
      expect(out.todayEvents).toEqual(1234);
      expect(out.topEvents[0].event).toEqual('pageview');
    });

    it('throws AppError with NOT_FOUND on 404', async () => {
      axiosGetMock.mockRejectedValueOnce(makeAxiosError(404));
      await expect(CloudPosthogProvider.getInstance().getSummary()).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.NOT_FOUND,
      });
    });

    it('throws AppError with UPSTREAM_FAILURE on network error', async () => {
      axiosGetMock.mockRejectedValueOnce(new Error('Network Error'));
      await expect(CloudPosthogProvider.getInstance().getSummary()).rejects.toMatchObject({
        statusCode: 502,
        code: ERROR_CODES.UPSTREAM_FAILURE,
      });
    });
  });

  describe('getRecentEvents', () => {
    it('parses events response with custom limit', async () => {
      axiosGetMock.mockResolvedValueOnce({
        data: {
          next: null,
          events: [
            { id: 'e1', event: 'pageview', distinctId: 'u1', timestamp: '2026-04-29T10:00:00Z' },
          ],
        },
      });
      const out = await CloudPosthogProvider.getInstance().getRecentEvents(5);
      expect(out.events).toHaveLength(1);
      expect(out.events[0].event).toEqual('pageview');
      const call = axiosGetMock.mock.calls[0];
      expect(call[1].params.limit).toEqual(5);
    });

    it('default limit is 10', async () => {
      axiosGetMock.mockResolvedValueOnce({ data: { next: null, events: [] } });
      await CloudPosthogProvider.getInstance().getRecentEvents();
      const call = axiosGetMock.mock.calls[0];
      expect(call[1].params.limit).toEqual(10);
    });

    it('throws AppError with NOT_FOUND on 404', async () => {
      axiosGetMock.mockRejectedValueOnce(makeAxiosError(404));
      await expect(CloudPosthogProvider.getInstance().getRecentEvents()).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.NOT_FOUND,
      });
    });
  });

  describe('disconnect', () => {
    it('issues DELETE to the correct URL', async () => {
      axiosDeleteMock.mockResolvedValueOnce({ status: 204 });

      await CloudPosthogProvider.getInstance().disconnect();

      expect(axiosDeleteMock).toHaveBeenCalledOnce();
      const callArgs = axiosDeleteMock.mock.calls[0];
      expect(callArgs[0]).toEqual(`${apiHost}/projects/v1/${projectId}/posthog/connection`);
    });

    it('throws AppError with UPSTREAM_FAILURE on error', async () => {
      axiosDeleteMock.mockRejectedValueOnce(makeAxiosError(500));

      await expect(CloudPosthogProvider.getInstance().disconnect()).rejects.toMatchObject({
        statusCode: 502,
        code: ERROR_CODES.UPSTREAM_FAILURE,
      });
    });
  });
});
