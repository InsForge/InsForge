import { describe, expect, it } from 'vitest';
import { diffConfig } from './diff.js';

describe('diffConfig', () => {
  it('detects auth modifications', () => {
    const live = { auth: { additional_redirect_urls: ['http://a'] } };
    const file = { auth: { additional_redirect_urls: ['http://a', 'http://b'] } };
    expect(diffConfig({ live, file })).toEqual({
      changes: [
        {
          section: 'auth',
          op: 'modify',
          key: 'additional_redirect_urls',
          from: ['http://a'],
          to: ['http://a', 'http://b'],
        },
      ],
      summary: { add: 0, modify: 1, remove: 0, kept: 0 },
    });
  });

  it('detects bucket add and modify', () => {
    const live = { storage: { buckets: { existing: { public: false } } } };
    const file = {
      storage: {
        buckets: {
          existing: { public: true },
          newone: { public: true },
        },
      },
    };
    const d = diffConfig({ live, file });
    expect(d.changes).toEqual(
      expect.arrayContaining([
        {
          section: 'storage.buckets',
          op: 'modify',
          key: 'existing',
          field: 'public',
          from: false,
          to: true,
        },
        { section: 'storage.buckets', op: 'add', key: 'newone', value: { public: true } },
      ])
    );
    expect(d.summary).toEqual({ add: 1, modify: 1, remove: 0, kept: 0 });
  });

  it('marks DB-only buckets as kept (not removed) by default', () => {
    const live = { storage: { buckets: { orphan: { public: true } } } };
    const file = { storage: { buckets: {} } };
    const d = diffConfig({ live, file });
    expect(d.changes).toEqual([
      { section: 'storage.buckets', op: 'remove', key: 'orphan', kept: true },
    ]);
    expect(d.summary).toEqual({ add: 0, modify: 0, remove: 0, kept: 1 });
  });

  it('marks DB-only buckets as removed when prune=true', () => {
    const live = { storage: { buckets: { orphan: { public: true } } } };
    const file = { storage: { buckets: {} } };
    const d = diffConfig({ live, file, prune: true });
    expect(d.changes).toEqual([
      { section: 'storage.buckets', op: 'remove', key: 'orphan', kept: false },
    ]);
    expect(d.summary).toEqual({ add: 0, modify: 0, remove: 1, kept: 0 });
  });

  it('returns no changes for converged state (idempotence sanity)', () => {
    const same = {
      auth: { additional_redirect_urls: ['http://a'] },
      storage: { buckets: { a: { public: true } } },
    };
    expect(diffConfig({ live: same, file: same })).toEqual({
      changes: [],
      summary: { add: 0, modify: 0, remove: 0, kept: 0 },
    });
  });
});
