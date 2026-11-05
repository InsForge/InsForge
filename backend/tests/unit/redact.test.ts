import { describe, expect, it } from 'vitest';

import { maskSecretForLog } from '@/utils/redact.js';

describe('maskSecretForLog', () => {
  it('keeps only a prefix and the last four characters', () => {
    expect(maskSecretForLog('ik_live_0123456789abcdef')).toBe('ik_l...cdef');
  });

  it('never returns the middle of a long secret', () => {
    const secret = 'ik_' + 'a'.repeat(40) + 'wxyz';
    const masked = maskSecretForLog(secret);

    expect(masked).not.toContain('a'.repeat(10));
    expect(masked.endsWith('wxyz')).toBe(true);
  });

  it('hides short values completely', () => {
    expect(maskSecretForLog('ik_shortkey')).toBe('***');
    expect(maskSecretForLog('')).toBe('(unset)');
    expect(maskSecretForLog(undefined)).toBe('(unset)');
  });

  it('is stable for the generated key shapes', () => {
    expect(maskSecretForLog('anon_' + 'x'.repeat(20) + 'WXYZ')).toBe('anon...WXYZ');
  });
});
