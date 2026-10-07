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
const UUID = '550e8400-e29b-41d4-a716-446655440000';
const SECOND_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('StorageService.generateObjectKey', () => {
  let service: StorageService;

  beforeEach(() => {
    service = StorageService.getInstance();
    vi.spyOn(Date, 'now').mockReturnValue(TIMESTAMP);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(UUID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes the full UUID from the cryptographically secure generator', () => {
    expect(service.generateObjectKey('photo.jpg')).toBe(`photo-${TIMESTAMP}-${UUID}.jpg`);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it('generates different keys for the same filename and millisecond', () => {
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(UUID).mockReturnValueOnce(SECOND_UUID);

    expect(service.generateObjectKey('photo.jpg')).toBe(`photo-${TIMESTAMP}-${UUID}.jpg`);
    expect(service.generateObjectKey('photo.jpg')).toBe(`photo-${TIMESTAMP}-${SECOND_UUID}.jpg`);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(2);
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
    expect(service.generateObjectKey(filename)).toBe(`${base}-${TIMESTAMP}-${UUID}${extension}`);
  });

  it('does not rely on Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used for object keys');
    });

    expect(service.generateObjectKey('photo.jpg')).toBe(`photo-${TIMESTAMP}-${UUID}.jpg`);
    expect(Math.random).not.toHaveBeenCalled();
  });

  it('propagates secure generator failures instead of using a weak fallback', () => {
    const error = new Error('Secure random generation failed');
    vi.mocked(crypto.randomUUID).mockImplementation(() => {
      throw error;
    });

    expect(() => service.generateObjectKey('photo.jpg')).toThrow(error);
  });
});
