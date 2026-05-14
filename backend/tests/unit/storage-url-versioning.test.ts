import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock environment before importing the service so getApiBaseUrl returns a
// stable host. The service caches the value at call time, not import time.
vi.mock('@/utils/environment.js', () => ({
  getApiBaseUrl: () => 'https://example.test',
}));

// Stub DatabaseManager so StorageService construction doesn't touch a pool.
vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: { getInstance: () => ({ getPool: () => ({}) }) },
}));

import { StorageService } from '../../src/services/storage/storage.service.ts';

type UrlBuilder = (bucket: string, key: string, version?: string | Date | null) => string;
type UrlAppender = (url: string, version: string | Date | null | undefined) => string;

describe('StorageService URL versioning', () => {
  let svc: StorageService;
  let buildObjectUrl: UrlBuilder;
  let appendVersionParam: UrlAppender;

  beforeEach(() => {
    svc = StorageService.getInstance();
    // The helpers are private; reach them via the prototype so we can test the
    // exact contract a CDN sees without instantiating an Express request.
    const proto = Object.getPrototypeOf(svc) as Record<string, unknown>;
    buildObjectUrl = (proto.buildObjectUrl as UrlBuilder).bind(svc);
    appendVersionParam = (proto.appendVersionParam as UrlAppender).bind(svc);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits ?v= when no version is supplied', () => {
    expect(buildObjectUrl('b', 'k')).toBe('https://example.test/api/storage/buckets/b/objects/k');
  });

  it('appends ?v=<etag> when an etag string is supplied', () => {
    expect(buildObjectUrl('b', 'k', 'abc123')).toBe(
      'https://example.test/api/storage/buckets/b/objects/k?v=abc123'
    );
  });

  it('uses epoch-ms when version is a Date', () => {
    const d = new Date('2024-01-02T03:04:05.000Z');
    expect(buildObjectUrl('b', 'k', d)).toBe(
      `https://example.test/api/storage/buckets/b/objects/k?v=${d.getTime()}`
    );
  });

  it('url-encodes the version stamp', () => {
    expect(buildObjectUrl('b', 'k', 'has spaces & symbols')).toBe(
      'https://example.test/api/storage/buckets/b/objects/k?v=has%20spaces%20%26%20symbols'
    );
  });

  it('url-encodes the object key', () => {
    expect(buildObjectUrl('b', 'folder/sub key.png', 'v1')).toBe(
      'https://example.test/api/storage/buckets/b/objects/folder%2Fsub%20key.png?v=v1'
    );
  });

  it('appendVersionParam uses ? when URL has no query string', () => {
    expect(appendVersionParam('https://cdn.example/path/a.png', 'etag1')).toBe(
      'https://cdn.example/path/a.png?v=etag1'
    );
  });

  it('appendVersionParam uses & when URL already has a query string', () => {
    expect(appendVersionParam('https://cdn.example/path/a.png?Signature=xyz', 'etag1')).toBe(
      'https://cdn.example/path/a.png?Signature=xyz&v=etag1'
    );
  });

  it('appendVersionParam is a no-op when no version supplied', () => {
    expect(appendVersionParam('https://cdn.example/p', null)).toBe('https://cdn.example/p');
    expect(appendVersionParam('https://cdn.example/p', undefined)).toBe('https://cdn.example/p');
    expect(appendVersionParam('https://cdn.example/p', '')).toBe('https://cdn.example/p');
  });
});
