import { describe, expect, it } from 'vitest';

import { serializePostgrestParams } from '@/services/database/postgrest-params.js';

describe('serializePostgrestParams', () => {
  it('repeats a key instead of using bracket form', () => {
    expect(serializePostgrestParams({ age: ['gte.18', 'lte.30'] })).toBe('age=gte.18&age=lte.30');
  });

  it('keeps single values unchanged', () => {
    const search = new URLSearchParams(serializePostgrestParams({ limit: '10', order: 'age.asc' }));

    expect(search.get('limit')).toBe('10');
    expect(search.get('order')).toBe('age.asc');
  });

  it('encodes characters that would otherwise change the filter', () => {
    const serialized = serializePostgrestParams({ price: 'eq.50%+1', name: 'eq.a b' });

    expect(serialized).toContain('price=eq.50%25%2B1');
    expect(serialized).toContain('name=eq.a+b');
  });

  it('drops absent values without leaving empty keys', () => {
    expect(serializePostgrestParams({ select: '*', limit: undefined, offset: null })).toBe(
      'select=*'
    );
  });

  it('returns an empty string without params', () => {
    expect(serializePostgrestParams(undefined)).toBe('');
    expect(serializePostgrestParams({})).toBe('');
  });
});
