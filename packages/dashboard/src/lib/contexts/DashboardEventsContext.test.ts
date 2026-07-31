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

  it('falls back to the broad records prefix for malformed table references', () => {
    expect(
      getDashboardInvalidationKeys({
        type: 'data-update',
        resource: 'database',
        data: { changes: [{ type: 'records', name: 'too.many.parts' }] },
      })
    ).toEqual([['records'], ['metadata', 'full']]);
  });

  it('invalidates both the deployment metadata and list queries', () => {
    expect(getDashboardInvalidationKeys({ type: 'data-update', resource: 'deployments' })).toEqual([
      ['deployment-metadata'],
      ['deployments'],
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
