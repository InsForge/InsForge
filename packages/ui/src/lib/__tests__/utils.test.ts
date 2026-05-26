import { describe, expect, it } from 'vitest';
import { cn } from '@insforge/ui';

describe('cn', () => {
  it('merges conditional classes and resolves Tailwind conflicts', () => {
    expect(cn('px-2', undefined, false, ['text-sm'], 'px-4')).toBe('text-sm px-4');
  });
});
