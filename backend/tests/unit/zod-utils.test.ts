import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseZodSchema } from '../../src/utils/zod';

describe('zod utils', () => {
  it('formats root-level validation issues with an explicit path', () => {
    expect(() => parseZodSchema(z.string().min(1), '')).toThrow('(root): String must contain');
  });
});
