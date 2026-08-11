import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxiosGet = vi.spyOn(axios, 'get');

// Re-import after mocking so the singleton picks up the mock.
const { GitHubService } = await import('../../src/services/github/github.service.js');

function freshService() {
  // Access the private constructor via type assertion to create an isolated
  // instance for each test without touching the shared singleton.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (GitHubService as any)() as InstanceType<typeof GitHubService>;
}

const VALID_RESPONSE = { data: { stargazers_count: 1234 } };

describe('GitHubService', () => {
  beforeEach(() => {
    mockedAxiosGet.mockReset();
  });

  it('returns stars from a successful GitHub response', async () => {
    mockedAxiosGet.mockResolvedValueOnce(VALID_RESPONSE);

    const service = freshService();
    const result = await service.getRepositoryMetadata();

    expect(result.stars).toBe(1234);
    expect(mockedAxiosGet).toHaveBeenCalledTimes(1);
  });

  it('serves the cached value without a second network call', async () => {
    mockedAxiosGet.mockResolvedValueOnce(VALID_RESPONSE);

    const service = freshService();
    await service.getRepositoryMetadata();
    const second = await service.getRepositoryMetadata();

    expect(second.stars).toBe(1234);
    expect(mockedAxiosGet).toHaveBeenCalledTimes(1);
  });

  it('returns null stars and still caches on network error', async () => {
    mockedAxiosGet.mockRejectedValueOnce(new Error('network error'));

    const service = freshService();
    const result = await service.getRepositoryMetadata();

    expect(result.stars).toBeNull();
    // Second call must hit the cache, not retry.
    const second = await service.getRepositoryMetadata();
    expect(second.stars).toBeNull();
    expect(mockedAxiosGet).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent calls into a single network request', async () => {
    let resolve!: (value: typeof VALID_RESPONSE) => void;
    const deferred = new Promise<typeof VALID_RESPONSE>((res) => {
      resolve = res;
    });
    mockedAxiosGet.mockReturnValueOnce(deferred);

    const service = freshService();

    // Fire three concurrent calls before the request settles.
    const [a, b, c] = await Promise.all([
      service.getRepositoryMetadata(),
      service.getRepositoryMetadata(),
      service.getRepositoryMetadata(),
      Promise.resolve().then(() => resolve(VALID_RESPONSE)),
    ]).then(([ra, rb, rc]) => [ra, rb, rc]);

    expect(a.stars).toBe(1234);
    expect(b.stars).toBe(1234);
    expect(c.stars).toBe(1234);
    // Only one real HTTP call must have gone out.
    expect(mockedAxiosGet).toHaveBeenCalledTimes(1);
  });
});
