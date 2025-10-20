import { ADMIN_ID } from '../../src/utils/constants';
import { describe, it, expect } from 'vitest';

describe('ADMIN_ID constant', () => {
  it('should have the correct fixed UUID value', () => {
    expect(ADMIN_ID).toBe('00000000-0000-0000-0000-000000000001');
  });
});
