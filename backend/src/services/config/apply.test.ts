import { describe, it, expect, vi } from 'vitest';
import { applyConfig } from './apply.js';

// Mock the section appliers so we test orchestration, not real DB writes.
vi.mock('../auth/settings.js', () => ({
  getAuthSettings: vi.fn().mockResolvedValue({
    additionalRedirectUrls: [],
  }),
  setAuthSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../storage/buckets.js', () => ({
  listBuckets: vi.fn().mockResolvedValue([{ name: 'avatars', public: false }]),
  upsertBucket: vi.fn().mockResolvedValue(undefined),
  deleteBucket: vi.fn().mockResolvedValue(undefined),
}));

describe('applyConfig', () => {
  it('returns plan only when dry_run=true and applies nothing', async () => {
    const { setAuthSettings } = await import('../auth/settings.js');
    const { upsertBucket } = await import('../storage/buckets.js');
    vi.clearAllMocks();
    const result = await applyConfig({
      config: { auth: { additional_redirect_urls: ['http://b'] } },
      dry_run: true,
      prune: false,
    });
    expect(result.plan.summary.modify).toBe(1);
    expect(result.applied).toBe(false);
    expect(setAuthSettings).not.toHaveBeenCalled();
    expect(upsertBucket).not.toHaveBeenCalled();
  });

  it('applies modifications and returns applied=true', async () => {
    const { setAuthSettings } = await import('../auth/settings.js');
    vi.clearAllMocks();
    await applyConfig({
      config: { auth: { additional_redirect_urls: ['http://b'] } },
      dry_run: false,
      prune: false,
    });
    expect(setAuthSettings).toHaveBeenCalledWith(
      expect.objectContaining({ additionalRedirectUrls: ['http://b'] }),
    );
  });

  it('does NOT delete orphaned bucket when prune=false', async () => {
    const { deleteBucket } = await import('../storage/buckets.js');
    vi.clearAllMocks();
    await applyConfig({
      config: { storage: { buckets: {} } },
      dry_run: false,
      prune: false,
    });
    expect(deleteBucket).not.toHaveBeenCalled();
  });

  it('deletes orphaned bucket when prune=true', async () => {
    const { deleteBucket } = await import('../storage/buckets.js');
    vi.clearAllMocks();
    await applyConfig({
      config: { storage: { buckets: {} } },
      dry_run: false,
      prune: true,
    });
    expect(deleteBucket).toHaveBeenCalledWith('avatars');
  });

  it('is a no-op on converged state', async () => {
    const { setAuthSettings } = await import('../auth/settings.js');
    const { upsertBucket } = await import('../storage/buckets.js');
    vi.clearAllMocks();
    const result = await applyConfig({
      config: {
        auth: {
          additional_redirect_urls: [],
        },
        storage: { buckets: { avatars: { public: false } } },
      },
      dry_run: false,
      prune: false,
    });
    expect(result.plan.changes).toEqual([]);
    expect(setAuthSettings).not.toHaveBeenCalled();
    expect(upsertBucket).not.toHaveBeenCalled();
  });
});
