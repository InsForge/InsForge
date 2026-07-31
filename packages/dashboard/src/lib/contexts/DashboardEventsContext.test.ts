import { describe, expect, it } from 'vitest';
import { getDashboardInvalidationKeys } from './DashboardEventsContext';

describe('getDashboardInvalidationKeys', () => {
  it('maps record changes to the table records and metadata queries', () => {
    expect(
      getDashboardInvalidationKeys({
        type: 'data-update',
        resource: 'database',
        data: { changes: [{ type: 'records', name: 'auth.users' }] },
      })
    ).toEqual([
      ['records', 'auth', 'users'],
      ['metadata', 'full'],
    ]);
  });

  it('invalidates compute services for compute events', () => {
    expect(
      getDashboardInvalidationKeys({ type: 'data-update', resource: 'compute_services' })
    ).toEqual([['compute', 'services']]);
  });

  it('uses broad database prefixes when a producer cannot identify changes', () => {
    expect(getDashboardInvalidationKeys({ type: 'data-update', resource: 'database' })).toEqual([
      ['database'],
      ['records'],
      ['metadata', 'full'],
    ]);
  });
});
