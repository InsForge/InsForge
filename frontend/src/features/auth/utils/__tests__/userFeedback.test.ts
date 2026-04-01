import { describe, expect, it } from 'vitest';
import { formatDeleteUsersToastMessage } from '../userFeedback';

describe('formatDeleteUsersToastMessage', () => {
  it('reports when no users were deleted', () => {
    expect(formatDeleteUsersToastMessage(1, 0)).toBe('No users were deleted');
  });

  it('reports a partial deletion accurately', () => {
    expect(formatDeleteUsersToastMessage(2, 1)).toBe('1 of 2 users deleted successfully');
  });

  it('reports a full deletion accurately', () => {
    expect(formatDeleteUsersToastMessage(2, 2)).toBe('2 users deleted successfully');
  });
});
