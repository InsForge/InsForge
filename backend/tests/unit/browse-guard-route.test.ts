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
    test('returns true when limit and offset are present', () => {
      const query = { limit: '50', offset: '0' };
      expect(isBrowseRequest('GET', query)).toBe(true);
    });

    test('returns false for POST requests', () => {
      const query = { limit: '50', offset: '0' };
      expect(isBrowseRequest('POST', query)).toBe(false);
    });

    test('returns false when limit is missing', () => {
      const query = { offset: '0' };
      expect(isBrowseRequest('GET', query)).toBe(false);
    });

    test('returns false when offset is missing', () => {
      const query = { limit: '50' };
      expect(isBrowseRequest('GET', query)).toBe(false);
    });
  });

  describe('extractSearchTerm', () => {
    test('extracts search term from PostgREST or filter', () => {
      const orFilter = '(name.ilike.*hello*,email.ilike.*hello*)';
      expect(extractSearchTerm(orFilter)).toBe('hello');
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
      expect(parseOrderParam('created_at.desc')).toEqual({
        column: 'created_at',
        direction: 'desc',
      });
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
