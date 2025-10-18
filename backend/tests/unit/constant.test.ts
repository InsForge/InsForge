import { ADMIN_ID } from '../../src/utils/constants';

describe('ADMIN_ID constant', () => {
  test('should have the correct fixed UUID value', () => {
    expect(ADMIN_ID).toBe('00000000-0000-0000-0000-000000000001');
  });
});