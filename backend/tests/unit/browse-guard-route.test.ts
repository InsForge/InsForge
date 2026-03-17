import { describe, test, expect, beforeAll } from 'vitest';

let isBrowseRequest: typeof import('../../src/api/routes/database/records.routes').isBrowseRequest;
let extractSearchTerm: typeof import('../../src/api/routes/database/records.routes').extractSearchTerm;
let parseOrderParam: typeof import('../../src/api/routes/database/records.routes').parseOrderParam;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  const mod = await import('../../src/api/routes/database/records.routes');
  isBrowseRequest = mod.isBrowseRequest;
  extractSearchTerm = mod.extractSearchTerm;
  parseOrderParam = mod.parseOrderParam;
});

describe('Browse guard route helpers', () => {
  describe('isBrowseRequest', () => {
    test('returns true for GET with limit and offset only', () => {
      expect(isBrowseRequest('GET', { limit: '50', offset: '0' }, false)).toBe(true);
    });

    test('returns true with order and or params', () => {
      const query = { limit: '50', offset: '0', order: 'id.asc', or: '(name.ilike.*x*)' };
      expect(isBrowseRequest('GET', query, false)).toBe(true);
    });

    test('returns false for POST requests', () => {
      expect(isBrowseRequest('POST', { limit: '50', offset: '0' }, false)).toBe(false);
    });

    test('returns false when limit is missing', () => {
      expect(isBrowseRequest('GET', { offset: '0' }, false)).toBe(false);
    });

    test('returns false when offset is missing', () => {
      expect(isBrowseRequest('GET', { limit: '50' }, false)).toBe(false);
    });

    test('returns false for wildcard path requests', () => {
      expect(isBrowseRequest('GET', { limit: '50', offset: '0' }, true)).toBe(false);
    });

    test('returns false when non-browse query keys are present', () => {
      expect(isBrowseRequest('GET', { limit: '50', offset: '0', select: 'id,name' }, false)).toBe(false);
    });

    test('returns false for column filter queries', () => {
      expect(isBrowseRequest('GET', { limit: '50', offset: '0', name: 'eq.foo' }, false)).toBe(false);
    });
  });

  describe('extractSearchTerm', () => {
    test('extracts search term from PostgREST or filter', () => {
      expect(extractSearchTerm('(name.ilike.*hello*,email.ilike.*hello*)')).toBe('hello');
    });

    test('returns null for undefined', () => {
      expect(extractSearchTerm(undefined)).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(extractSearchTerm('')).toBeNull();
    });

    test('returns null for malformed or filter', () => {
      expect(extractSearchTerm('(invalid)')).toBeNull();
    });
  });

  describe('parseOrderParam', () => {
    test('parses order into column and direction', () => {
      expect(parseOrderParam('created_at.desc')).toEqual({ column: 'created_at', direction: 'desc' });
    });

    test('defaults direction to asc', () => {
      expect(parseOrderParam('name')).toEqual({ column: 'name', direction: 'asc' });
    });

    test('returns null for undefined', () => {
      expect(parseOrderParam(undefined)).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(parseOrderParam('')).toBeNull();
    });
  });
});
