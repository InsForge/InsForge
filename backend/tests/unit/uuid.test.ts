import { describe, test, expect } from 'vitest';
import { generateUUID } from '../../src/utils/utils';

describe('generateUUID', () => {
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  test('returns a string', () => {
    const uuid = generateUUID();
    expect(typeof uuid).toBe('string');
  });

  test('returns a valid UUID v4', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(uuidV4Regex);
  });

  test('generates unique UUIDs on multiple calls', () => {
    const uuids = new Set(Array.from({ length: 10 }, () => generateUUID()));
    expect(uuids.size).toBe(10);
  });
});
