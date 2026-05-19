import { describe, expect, it } from 'vitest';
import { normalizeHeaders } from '#features/functions/helpers';

describe('normalizeHeaders', () => {
  it('normalizes object and JSON-string headers to string records', () => {
    expect(normalizeHeaders({ Accept: 'application/json', Retries: 2 })).toEqual({
      Accept: 'application/json',
      Retries: '2',
    });
    expect(normalizeHeaders('{"Content-Type":"application/json","Enabled":true}')).toEqual({
      'Content-Type': 'application/json',
      Enabled: 'true',
    });
  });

  it('returns undefined for null, invalid JSON, and non-object inputs', () => {
    expect(normalizeHeaders(null)).toBeUndefined();
    expect(normalizeHeaders('not-json')).toBeUndefined();
    expect(normalizeHeaders('"string"')).toBeUndefined();
    expect(normalizeHeaders(42)).toBeUndefined();
  });
});
