import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { handle } from '@/api/routes/s3-gateway/commands/list-objects-v2.js';

afterEach(() => {
  vi.restoreAllMocks();
});

interface DbRow {
  key: string;
  size: number;
  etag: string | null;
  lastModified: Date;
}

function row(key: string): DbRow {
  return { key, size: 1, etag: 'e', lastModified: new Date('2026-01-01T00:00:00.000Z') };
}

/**
 * Stands in for storage.objects: keys sorted ascending, filtered by prefix and
 * an exclusive `startAfter`, windowed by `maxKeys`. This is exactly the
 * contract of StorageService.listObjectsV2Db.
 */
function fakeTable(keys: string[]) {
  const sorted = [...keys].sort();
  return (params: { prefix?: string; startAfter?: string; maxKeys: number }): DbRow[] =>
    sorted
      .filter((k) => k.startsWith(params.prefix ?? ''))
      .filter((k) => params.startAfter === undefined || k > params.startAfter)
      .slice(0, params.maxKeys)
      .map(row);
}

interface ListResult {
  status: number;
  xml: string;
  isTruncated: boolean;
  keyCount: number;
  nextToken?: string;
  contents: string[];
  commonPrefixes: string[];
  dbCalls: number;
}

async function list(keys: string[], query: Record<string, string> = {}): Promise<ListResult> {
  const svc = StorageService.getInstance();
  vi.spyOn(svc, 'bucketExists').mockResolvedValue(true);
  const table = fakeTable(keys);
  let dbCalls = 0;
  vi.spyOn(svc, 'listObjectsV2Db').mockImplementation(async (params) => {
    dbCalls++;
    return table(params);
  });

  const status = vi.fn().mockReturnThis();
  const type = vi.fn().mockReturnThis();
  const send = vi.fn();
  const res = { status, type, send } as unknown as Response;

  const req = {
    query,
    path: '/test-bucket',
    s3Bucket: 'test-bucket',
    s3Key: null,
    s3Op: 'ListObjectsV2',
    s3Auth: { requestId: 'test-req' },
  };

  await handle(req as never, res);

  const xml = (send.mock.calls[0]?.[0] as string) ?? '';
  const capture = (tag: string) => xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`))?.[1];
  const captureAll = (tag: string) =>
    [...xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, 'g'))].map((m) => m[1]);

  return {
    status: status.mock.calls[0]?.[0] as number,
    xml,
    isTruncated: capture('IsTruncated') === 'true',
    keyCount: Number(capture('KeyCount')),
    nextToken: capture('NextContinuationToken'),
    contents: captureAll('Key'),
    commonPrefixes: captureAll('Prefix').filter((p) => p !== (query.prefix ?? '')),
    dbCalls,
  };
}

/** Walks every page the way an SDK paginator does, and returns what it saw. */
async function listAllPages(keys: string[], query: Record<string, string> = {}) {
  const contents: string[] = [];
  const commonPrefixes: string[] = [];
  let token: string | undefined;
  let pages = 0;

  do {
    const page = await list(keys, token ? { ...query, 'continuation-token': token } : query);
    expect(page.status).toBe(200);
    // A paginator can only continue when truncation comes with a token.
    if (page.isTruncated) {
      expect(page.nextToken).toBeDefined();
    }
    contents.push(...page.contents);
    commonPrefixes.push(...page.commonPrefixes);
    token = page.isTruncated ? page.nextToken : undefined;
    pages++;
    expect(pages).toBeLessThan(50);
  } while (token);

  return { contents, commonPrefixes, pages };
}

describe('ListObjectsV2 max-keys=0', () => {
  it('returns an empty, untruncated listing instead of truncating with no token', async () => {
    const result = await list(['a.txt', 'b.txt'], { 'max-keys': '0' });

    expect(result.status).toBe(200);
    expect(result.keyCount).toBe(0);
    expect(result.isTruncated).toBe(false);
    expect(result.nextToken).toBeUndefined();
    expect(result.xml).toContain('<MaxKeys>0</MaxKeys>');
  });

  it('does not query the database at all', async () => {
    const result = await list(['a.txt', 'b.txt'], { 'max-keys': '0' });

    expect(result.dbCalls).toBe(0);
  });

  it('still rejects a negative or non-integer max-keys', async () => {
    const negative = await list(['a.txt'], { 'max-keys': '-1' });
    expect(negative.status).toBe(400);
    expect(negative.xml).toContain('InvalidArgument');

    const fractional = await list(['a.txt'], { 'max-keys': '1.5' });
    expect(fractional.status).toBe(400);
  });
});

describe('ListObjectsV2 truncation contract', () => {
  it('advertises truncation with a usable token when a page fills up', async () => {
    const result = await list(['a.txt', 'b.txt', 'c.txt'], { 'max-keys': '2' });

    expect(result.contents).toEqual(['a.txt', 'b.txt']);
    expect(result.isTruncated).toBe(true);
    expect(result.nextToken).toBeDefined();
  });

  it('does not advertise truncation when the listing ends exactly on the limit', async () => {
    const result = await list(['a.txt', 'b.txt'], { 'max-keys': '2' });

    expect(result.isTruncated).toBe(false);
    expect(result.nextToken).toBeUndefined();
  });

  it('resumes from the token without repeating or skipping keys', async () => {
    const keys = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'];

    const { contents, pages } = await listAllPages(keys, { 'max-keys': '2' });

    expect(contents).toEqual(keys);
    expect(pages).toBe(3);
  });

  it('reports truncation when the per-request scan cap stops the walk early', async () => {
    const svc = StorageService.getInstance();
    vi.spyOn(svc, 'bucketExists').mockResolvedValue(true);
    // Every window is a full page of keys inside one folder, so the visible
    // entry count never reaches maxKeys and the scan runs until the internal
    // page cap stops it with rows still unread.
    let seq = 0;
    vi.spyOn(svc, 'listObjectsV2Db').mockImplementation(async (params) =>
      Array.from({ length: params.maxKeys }, () => row(`folder/${String(seq++).padStart(9, '0')}`))
    );

    const status = vi.fn().mockReturnThis();
    const type = vi.fn().mockReturnThis();
    const send = vi.fn();
    const res = { status, type, send } as unknown as Response;
    const req = {
      query: { delimiter: '/' },
      path: '/test-bucket',
      s3Bucket: 'test-bucket',
      s3Key: null,
      s3Op: 'ListObjectsV2',
      s3Auth: { requestId: 'test-req' },
    };

    await handle(req as never, res);

    const xml = send.mock.calls[0][0] as string;
    expect(xml).toContain('<IsTruncated>true</IsTruncated>');
    expect(xml).toContain('<NextContinuationToken>');
  });
});

describe('ListObjectsV2 delimiter pagination', () => {
  it('does not return a CommonPrefix that a previous page already returned', async () => {
    // "a/" spans two DB rows, so a page break lands inside the group.
    const keys = ['a/1', 'a/2', 'b/1'];

    const { commonPrefixes } = await listAllPages(keys, { delimiter: '/', 'max-keys': '1' });

    expect(commonPrefixes).toEqual(['a/', 'b/']);
  });

  it('keeps folders and loose keys in order across pages', async () => {
    const keys = ['docs/a', 'docs/b', 'docs/c', 'notes.txt', 'photos/x', 'photos/y', 'readme.md'];

    const { contents, commonPrefixes } = await listAllPages(keys, {
      delimiter: '/',
      'max-keys': '2',
    });

    expect(commonPrefixes).toEqual(['docs/', 'photos/']);
    expect(contents).toEqual(['notes.txt', 'readme.md']);
  });

  it('collapses a group that spans several pages into exactly one CommonPrefix', async () => {
    const keys = [...Array(10).keys()].map((i) => `bulk/${i}`).concat('zz.txt');

    const { contents, commonPrefixes } = await listAllPages(keys, {
      delimiter: '/',
      'max-keys': '1',
    });

    expect(commonPrefixes).toEqual(['bulk/']);
    expect(contents).toEqual(['zz.txt']);
  });

  it('scopes CommonPrefixes to the requested prefix', async () => {
    const keys = ['top/nested/a', 'top/nested/b', 'top/leaf.txt', 'other/x'];

    const { contents, commonPrefixes } = await listAllPages(keys, {
      delimiter: '/',
      prefix: 'top/',
      'max-keys': '1',
    });

    expect(commonPrefixes).toEqual(['top/nested/']);
    expect(contents).toEqual(['top/leaf.txt']);
  });
});

describe('ListObjectsV2 start-after and continuation-token', () => {
  it('starts after the given key when only start-after is supplied', async () => {
    const result = await list(['a.txt', 'b.txt', 'c.txt'], { 'start-after': 'a.txt' });

    expect(result.contents).toEqual(['b.txt', 'c.txt']);
  });

  it('ignores start-after when a continuation token is present', async () => {
    const first = await list(['a.txt', 'b.txt', 'c.txt'], { 'max-keys': '1' });
    expect(first.nextToken).toBeDefined();

    const second = await list(['a.txt', 'b.txt', 'c.txt'], {
      'max-keys': '1',
      'start-after': 'c.txt',
      'continuation-token': first.nextToken as string,
    });

    // start-after would have resumed past c.txt and returned nothing.
    expect(second.contents).toEqual(['b.txt']);
  });

  it('accepts a legacy bare-key continuation token', async () => {
    const legacy = Buffer.from('a.txt', 'utf8').toString('base64url');

    const result = await list(['a.txt', 'b.txt', 'c.txt'], { 'continuation-token': legacy });

    expect(result.contents).toEqual(['b.txt', 'c.txt']);
  });
});
