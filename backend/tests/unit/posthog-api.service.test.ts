import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { axiosGet } = vi.hoisted(() => ({ axiosGet: vi.fn() }));
vi.mock('axios', () => {
  const isAxiosError = (err: unknown) =>
    (err as { __isAxiosError?: boolean })?.__isAxiosError === true;
  return {
    default: { get: axiosGet, post: vi.fn(), patch: vi.fn(), isAxiosError },
    isAxiosError,
  };
});

const { PostHogApiService } = await import('../../src/services/analytics/posthog-api.service.js');

const HOST = 'https://us.posthog.com';
const KEY = 'phx_key';

function rateLimited(retryAfter?: string) {
  const err = new Error('429') as Error & {
    __isAxiosError: true;
    response: { status: number; headers: Record<string, string> };
  };
  err.__isAxiosError = true;
  err.response = { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} };
  return err;
}

function page(results: unknown[], next: string | null = null) {
  return { data: { results, next } };
}

describe('PostHogApiService', () => {
  let service: InstanceType<typeof PostHogApiService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PostHogApiService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('discovery pagination', () => {
    it('follows next links until exhausted', async () => {
      axiosGet
        .mockResolvedValueOnce(page([{ id: 'org-1' }], `${HOST}/api/organizations/?offset=1`))
        .mockResolvedValueOnce(page([{ id: 'org-2' }]));

      const orgs = await service.listOrganizations({ personalApiKey: KEY, host: HOST });

      expect(orgs.map((o) => o.id)).toEqual(['org-1', 'org-2']);
      expect(axiosGet).toHaveBeenCalledTimes(2);
      expect(axiosGet.mock.calls[1][0]).toBe(`${HOST}/api/organizations/?offset=1`);
    });

    it('treats a next link pointing off the validated host as the end', async () => {
      axiosGet.mockResolvedValueOnce(
        page([{ id: 'org-1' }], 'https://evil.example.com/api/organizations/?offset=1')
      );

      const orgs = await service.listOrganizations({ personalApiKey: KEY, host: HOST });

      expect(orgs.map((o) => o.id)).toEqual(['org-1']);
      expect(axiosGet).toHaveBeenCalledTimes(1);
    });

    // Truncation must be loud: the connect flow treats the list as exhaustive,
    // so a silently partial result hides valid projects.
    it('throws instead of returning a partial list when the page cap is hit', async () => {
      axiosGet.mockResolvedValue(page([{ id: 'org' }], `${HOST}/api/organizations/?offset=1`));

      await expect(service.listOrganizations({ personalApiKey: KEY, host: HOST })).rejects.toThrow(
        /refusing to return a partial list/
      );
    });

    it('refuses an untrusted host outright', async () => {
      await expect(
        service.listOrganizations({ personalApiKey: KEY, host: 'https://evil.example.com' })
      ).rejects.toThrow(/Untrusted PostHog host/);
      expect(axiosGet).not.toHaveBeenCalled();
    });
  });

  describe('429 retry', () => {
    it('retries once after the Retry-After delay', async () => {
      vi.useFakeTimers();
      axiosGet.mockRejectedValueOnce(rateLimited('2')).mockResolvedValueOnce(page([]));

      const pending = service.listEvents({
        personalApiKey: KEY,
        host: HOST,
        posthogProjectId: '1',
      });
      await vi.advanceTimersByTimeAsync(2000);

      await expect(pending).resolves.toEqual({ results: [], next: null });
      expect(axiosGet).toHaveBeenCalledTimes(2);
    });

    // Ported behaviour: a 429 with no usable header still gets the one retry,
    // after a 1s fallback, rather than failing the request immediately.
    it('falls back to a 1s delay when Retry-After is missing', async () => {
      vi.useFakeTimers();
      axiosGet.mockRejectedValueOnce(rateLimited()).mockResolvedValueOnce(page([]));

      const pending = service.listEvents({
        personalApiKey: KEY,
        host: HOST,
        posthogProjectId: '1',
      });
      await vi.advanceTimersByTimeAsync(1000);

      await expect(pending).resolves.toEqual({ results: [], next: null });
      expect(axiosGet).toHaveBeenCalledTimes(2);
    });

    it('honours the HTTP-date form of Retry-After', async () => {
      vi.useFakeTimers();
      const inThree = new Date(Date.now() + 3000).toUTCString();
      axiosGet.mockRejectedValueOnce(rateLimited(inThree)).mockResolvedValueOnce(page([]));

      const pending = service.listEvents({
        personalApiKey: KEY,
        host: HOST,
        posthogProjectId: '1',
      });
      await vi.advanceTimersByTimeAsync(3000);

      await expect(pending).resolves.toEqual({ results: [], next: null });
      expect(axiosGet).toHaveBeenCalledTimes(2);
    });

    it('surfaces the 429 when the requested delay exceeds the cap', async () => {
      axiosGet.mockRejectedValue(rateLimited('31'));

      await expect(
        service.listEvents({ personalApiKey: KEY, host: HOST, posthogProjectId: '1' })
      ).rejects.toThrow('429');
      expect(axiosGet).toHaveBeenCalledTimes(1);
    });
  });
});
