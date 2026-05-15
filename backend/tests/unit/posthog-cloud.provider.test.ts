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
const axiosPostMock = vi.fn();
const axiosIsAxiosError = vi.fn((err: unknown) => {
  return (err as { __isAxiosError?: boolean })?.__isAxiosError === true;
});

vi.mock('axios', () => {
  return {
    default: {
      get: axiosGetMock,
      delete: axiosDeleteMock,
      post: axiosPostMock,
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

  describe('getWebOverview', () => {
    it('forwards timeframe and parses response', async () => {
      axiosGetMock.mockResolvedValueOnce({
        data: {
          items: [
            {
              key: 'visitors',
              value: 100,
              previous: 80,
              changeFromPreviousPct: 25,
              isIncreaseBad: false,
            },
          ],
        },
      });

      const out = await CloudPosthogProvider.getInstance().getWebOverview('7d');
      expect(out.items).toHaveLength(1);
      expect(out.items[0].key).toEqual('visitors');

      const call = axiosGetMock.mock.calls[0];
      expect(call[0]).toEqual(`${apiHost}/projects/v1/${projectId}/posthog/web-overview`);
      expect(call[1].params.timeframe).toEqual('7d');
    });

    it('throws AppError with NOT_FOUND on 404', async () => {
      axiosGetMock.mockRejectedValueOnce(makeAxiosError(404));
      await expect(CloudPosthogProvider.getInstance().getWebOverview('7d')).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.NOT_FOUND,
      });
    });

    it('throws AppError with UPSTREAM_FAILURE on network error', async () => {
      axiosGetMock.mockRejectedValueOnce(new Error('Network Error'));
      await expect(CloudPosthogProvider.getInstance().getWebOverview('7d')).rejects.toMatchObject({
        statusCode: 502,
        code: ERROR_CODES.UPSTREAM_FAILURE,
      });
    });
  });

  describe('getWebStats', () => {
    it('forwards breakdown and timeframe and parses response', async () => {
      axiosGetMock.mockResolvedValueOnce({
        data: {
          rows: [{ breakdownValue: '/home', visitors: 50, views: 100, uiFillFraction: 1.0 }],
        },
      });

      const out = await CloudPosthogProvider.getInstance().getWebStats('Page', '7d');
      expect(out.rows).toHaveLength(1);
      expect(out.rows[0].breakdownValue).toEqual('/home');

      const call = axiosGetMock.mock.calls[0];
      expect(call[0]).toEqual(`${apiHost}/projects/v1/${projectId}/posthog/web-stats`);
      expect(call[1].params).toEqual({ breakdown: 'Page', timeframe: '7d' });
    });

    it('throws AppError with UPSTREAM_FAILURE on network error', async () => {
      axiosGetMock.mockRejectedValueOnce(new Error('Network Error'));
      await expect(
        CloudPosthogProvider.getInstance().getWebStats('Page', '7d')
      ).rejects.toMatchObject({
        statusCode: 502,
        code: ERROR_CODES.UPSTREAM_FAILURE,
      });
    });
  });

  describe('getTrends', () => {
    it('forwards metric and timeframe and parses response', async () => {
      axiosGetMock.mockResolvedValueOnce({
        data: {
          series: [
            { date: '2026-05-01', count: 10 },
            { date: '2026-05-02', count: 12 },
          ],
        },
      });

      const out = await CloudPosthogProvider.getInstance().getTrends('visitors', '7d');
      expect(out.series).toHaveLength(2);

      const call = axiosGetMock.mock.calls[0];
      expect(call[0]).toEqual(`${apiHost}/projects/v1/${projectId}/posthog/trends`);
      expect(call[1].params).toEqual({ metric: 'visitors', timeframe: '7d' });
    });

    it('throws AppError with NOT_FOUND on 404', async () => {
      axiosGetMock.mockRejectedValueOnce(makeAxiosError(404));
      await expect(
        CloudPosthogProvider.getInstance().getTrends('visitors', '7d')
      ).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.NOT_FOUND,
      });
    });
  });

  describe('getRetention', () => {
    it('parses retention response', async () => {
      axiosGetMock.mockResolvedValueOnce({
        data: {
          rows: [
            {
              date: '2026-04-29',
              label: 'Week 0',
              values: [{ count: 100 }, { count: 50 }, { count: null }],
            },
          ],
        },
      });

      const out = await CloudPosthogProvider.getInstance().getRetention();
      expect(out.rows).toHaveLength(1);
      expect(out.rows[0].values).toHaveLength(3);

      const call = axiosGetMock.mock.calls[0];
      expect(call[0]).toEqual(`${apiHost}/projects/v1/${projectId}/posthog/retention`);
    });

    it('throws AppError with UPSTREAM_FAILURE on network error', async () => {
      axiosGetMock.mockRejectedValueOnce(new Error('Network Error'));
      await expect(CloudPosthogProvider.getInstance().getRetention()).rejects.toMatchObject({
        statusCode: 502,
        code: ERROR_CODES.UPSTREAM_FAILURE,
      });
    });
  });

  describe('getRecordings', () => {
    it('forwards limit and parses response', async () => {
      axiosGetMock.mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'r1',
              distinctId: 'u1',
              durationSeconds: 60,
              startTime: '2026-05-01T00:00:00Z',
              endTime: '2026-05-01T00:01:00Z',
              startUrl: '/home',
              clickCount: 3,
              consoleErrorCount: 0,
            },
          ],
        },
      });

      const out = await CloudPosthogProvider.getInstance().getRecordings(20);
      expect(out.items).toHaveLength(1);

      const call = axiosGetMock.mock.calls[0];
      expect(call[0]).toEqual(`${apiHost}/projects/v1/${projectId}/posthog/recordings`);
      expect(call[1].params.limit).toEqual(20);
    });

    it('default limit is 10', async () => {
      axiosGetMock.mockResolvedValueOnce({ data: { items: [] } });
      await CloudPosthogProvider.getInstance().getRecordings();
      const call = axiosGetMock.mock.calls[0];
      expect(call[1].params.limit).toEqual(10);
    });

    it('throws AppError with NOT_FOUND on 404', async () => {
      axiosGetMock.mockRejectedValueOnce(makeAxiosError(404));
      await expect(CloudPosthogProvider.getInstance().getRecordings()).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.NOT_FOUND,
      });
    });
  });

  describe('createRecordingShare', () => {
    it('POSTs to the correct URL with URL-encoded id and parses response', async () => {
      axiosPostMock.mockResolvedValueOnce({
        data: { embedUrl: 'https://us.posthog.com/embedded/abc' },
      });

      const out = await CloudPosthogProvider.getInstance().createRecordingShare('rec id/1');
      expect(out.embedUrl).toEqual('https://us.posthog.com/embedded/abc');

      const call = axiosPostMock.mock.calls[0];
      expect(call[0]).toEqual(
        `${apiHost}/projects/v1/${projectId}/posthog/recordings/rec%20id%2F1/share`
      );
    });

    it('rejects non-posthog.com embedUrl as schema violation (502)', async () => {
      axiosPostMock.mockResolvedValueOnce({
        data: { embedUrl: 'https://evil.example.com/embedded/abc' },
      });

      await expect(
        CloudPosthogProvider.getInstance().createRecordingShare('rec1')
      ).rejects.toMatchObject({
        statusCode: 502,
        code: ERROR_CODES.UPSTREAM_FAILURE,
      });
    });

    it('throws AppError with NOT_FOUND on 404', async () => {
      axiosPostMock.mockRejectedValueOnce(makeAxiosError(404));
      await expect(
        CloudPosthogProvider.getInstance().createRecordingShare('rec1')
      ).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.NOT_FOUND,
      });
    });

    it('throws AppError with UPSTREAM_FAILURE on network error', async () => {
      axiosPostMock.mockRejectedValueOnce(new Error('Network Error'));
      await expect(
        CloudPosthogProvider.getInstance().createRecordingShare('rec1')
      ).rejects.toMatchObject({
        statusCode: 502,
        code: ERROR_CODES.UPSTREAM_FAILURE,
      });
    });
  });
});
