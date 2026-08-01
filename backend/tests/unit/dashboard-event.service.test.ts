import { describe, expect, it, vi } from 'vitest';
import { dashboardEventService } from '../../src/services/dashboard/dashboard-event.service.js';

describe('DashboardEventService', () => {
  it('publishes events only to active subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = dashboardEventService.subscribe(listener);

    dashboardEventService.publishDataUpdate({
      resource: 'database',
      data: { changes: [{ type: 'records', name: 'public.todos' }] },
    });
    unsubscribe();
    dashboardEventService.publishDataUpdate({ resource: 'users' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      type: 'data-update',
      resource: 'database',
      data: { changes: [{ type: 'records', name: 'public.todos' }] },
    });
  });

  it('keeps delivering to other subscribers when one listener throws', () => {
    const failing = vi.fn(() => {
      throw new Error('write after end');
    });
    const healthy = vi.fn();
    const unsubscribeFailing = dashboardEventService.subscribe(failing);
    const unsubscribeHealthy = dashboardEventService.subscribe(healthy);

    expect(() => dashboardEventService.publishDataUpdate({ resource: 'users' })).not.toThrow();

    expect(failing).toHaveBeenCalledOnce();
    expect(healthy).toHaveBeenCalledOnce();
    unsubscribeFailing();
    unsubscribeHealthy();
  });
});
