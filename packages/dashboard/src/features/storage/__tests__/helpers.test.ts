import { describe, expect, it } from 'vitest';

import { nextAvailableObjectKey } from '#features/storage/helpers';

describe('nextAvailableObjectKey', () => {
  it('returns the desired key when it is free', () => {
    expect(nextAvailableObjectKey(['other.png'], 'photo.png')).toBe('photo.png');
  });

  it('appends (1) on the first conflict', () => {
    expect(nextAvailableObjectKey(['photo.png'], 'photo.png')).toBe('photo (1).png');
  });

  it('increments past the highest existing counter', () => {
    expect(
      nextAvailableObjectKey(['photo.png', 'photo (1).png', 'photo (4).png'], 'photo.png')
    ).toBe('photo (5).png');
  });

  it('handles keys without an extension', () => {
    expect(nextAvailableObjectKey(['notes', 'notes (2)'], 'notes')).toBe('notes (3)');
  });

  it('treats dotfiles as extensionless names', () => {
    expect(nextAvailableObjectKey(['.env'], '.env')).toBe('.env (1)');
  });

  it('escapes regex characters in the file name', () => {
    expect(nextAvailableObjectKey(['a+b (1).png', 'a+b.png'], 'a+b.png')).toBe('a+b (2).png');
  });

  it('ignores counters on other names and in folders', () => {
    expect(
      nextAvailableObjectKey(['myphoto (3).png', 'dir/photo (7).png', 'photo.png'], 'photo.png')
    ).toBe('photo (1).png');
  });
});
