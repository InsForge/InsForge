import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/environment.js', () => ({
  getApiBaseUrl: () => 'https://example.test',
  isCloudEnvironment: () => true,
}));

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: { getInstance: () => ({ getPool: () => ({}) }) },
}));

import { StorageService } from '@/services/storage/storage.service.js';

const TIMESTAMP = 1737546841234;
const RANDOM_BYTES = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const RANDOM_SUFFIX = 'AAECAwQFBgcICQoLDA0ODw';
const SECOND_RANDOM_BYTES = Buffer.alloc(16, 255);

describe('StorageService.generateObjectKey', () => {
  let service: StorageService;

  beforeEach(() => {
    service = StorageService.getInstance();
    vi.spyOn(Date, 'now').mockReturnValue(TIMESTAMP);
    vi.spyOn(crypto, 'randomBytes').mockImplementation(() => RANDOM_BYTES);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encodes all 16 secure random bytes as a 22-character URL-safe suffix', () => {
    const key = service.generateObjectKey('photo.jpg');
    const suffix = key.slice(`photo-${TIMESTAMP}-`.length, -'.jpg'.length);

    expect(key).toBe(`photo-${TIMESTAMP}-${RANDOM_SUFFIX}.jpg`);
    expect(suffix).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(suffix, 'base64url')).toEqual(RANDOM_BYTES);
    expect(crypto.randomBytes).toHaveBeenCalledExactlyOnceWith(16);
  });

  it('generates different keys for the same filename and millisecond', () => {
    vi.mocked(crypto.randomBytes)
      .mockImplementationOnce(() => RANDOM_BYTES)
      .mockImplementationOnce(() => SECOND_RANDOM_BYTES);

    expect(service.generateObjectKey('photo.jpg')).toBe(`photo-${TIMESTAMP}-${RANDOM_SUFFIX}.jpg`);
    const secondKey = service.generateObjectKey('photo.jpg');
    expect(secondKey).toBe(`photo-${TIMESTAMP}-${SECOND_RANDOM_BYTES.toString('base64url')}.jpg`);
    expect(secondKey).toMatch(/^photo-\d+-[A-Za-z0-9_-]{22}\.jpg$/);
    expect(crypto.randomBytes).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['profile photo!@#.png', 'profile-photo---', '.png'],
    ['My_photo-1.JPG', 'My_photo-1', '.JPG'],
    ['folder/photo.jpg', 'photo', '.jpg'],
    ['archive.tar.gz', 'archive-tar', '.gz'],
    [`${'a'.repeat(40)}.txt`, 'a'.repeat(32), '.txt'],
    ['README', 'README', ''],
    ['', 'file', ''],
  ])('preserves filename handling for %j', (filename, base, extension) => {
    expect(service.generateObjectKey(filename)).toBe(
      `${base}-${TIMESTAMP}-${RANDOM_SUFFIX}${extension}`
    );
  });

  it('preserves a 210-character extension while fitting the local filename limit', () => {
    const extension = `.${'x'.repeat(210)}`;
    const key = service.generateObjectKey(`a${extension}`);

    expect(key).toBe(`a-${TIMESTAMP}-${RANDOM_SUFFIX}${extension}`);
    expect(Buffer.byteLength(key, 'utf8')).toBe(249);
    expect(Buffer.byteLength(key, 'utf8')).toBeLessThanOrEqual(255);
  });

  it.each([
    [185, 32],
    [186, 31],
    [190, 27],
    [217, 0],
  ])(
    'preserves a %i-character extension by limiting the base to %i bytes',
    (length, baseLength) => {
      const extension = `.${'x'.repeat(length)}`;
      const key = service.generateObjectKey(`${'a'.repeat(32)}${extension}`);

      expect(key).toBe(`${'a'.repeat(baseLength)}-${TIMESTAMP}-${RANDOM_SUFFIX}${extension}`);
      expect(Buffer.byteLength(key, 'utf8')).toBe(255);
    }
  );

  it.each([
    ['é', 95, 27],
    ['😀', 48, 25],
  ])(
    'preserves a multibyte %s extension by shortening only the base',
    (character, count, baseLength) => {
      const extension = `.${character.repeat(count)}`;
      const key = service.generateObjectKey(`${'a'.repeat(32)}${extension}`);

      expect(key).toBe(`${'a'.repeat(baseLength)}-${TIMESTAMP}-${RANDOM_SUFFIX}${extension}`);
      expect(Buffer.byteLength(key, 'utf8')).toBe(255);
    }
  );

  it('trims the extension only when it cannot fit even with an empty base', () => {
    const key = service.generateObjectKey(`a.${'x'.repeat(218)}`);

    expect(key).toBe(`-${TIMESTAMP}-${RANDOM_SUFFIX}.${'x'.repeat(217)}`);
    expect(Buffer.byteLength(key, 'utf8')).toBe(255);
  });

  it('does not split Unicode characters when an oversized extension must be trimmed', () => {
    const key = service.generateObjectKey(`a.${'😀'.repeat(55)}`);

    expect(key).toBe(`-${TIMESTAMP}-${RANDOM_SUFFIX}.${'😀'.repeat(54)}`);
    expect(Buffer.byteLength(key, 'utf8')).toBe(254);
    expect(Buffer.from(key, 'utf8').toString('utf8')).toBe(key);
  });

  it('calculates the budget using the actual timestamp length', () => {
    const timestamp = 10_000_000_000_000;
    vi.mocked(Date.now).mockReturnValue(timestamp);
    const extension = `.${'x'.repeat(190)}`;
    const key = service.generateObjectKey(`${'a'.repeat(32)}${extension}`);

    expect(key).toBe(`${'a'.repeat(26)}-${timestamp}-${RANDOM_SUFFIX}${extension}`);
    expect(Buffer.byteLength(key, 'utf8')).toBe(255);
  });

  it('does not rely on Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used for object keys');
    });

    expect(service.generateObjectKey('photo.jpg')).toBe(`photo-${TIMESTAMP}-${RANDOM_SUFFIX}.jpg`);
    expect(Math.random).not.toHaveBeenCalled();
  });

  it('propagates secure generator failures instead of using a weak fallback', () => {
    const error = new Error('Secure random generation failed');
    vi.mocked(crypto.randomBytes).mockImplementation(() => {
      throw error;
    });

    expect(() => service.generateObjectKey('photo.jpg')).toThrow(error);
  });
});
