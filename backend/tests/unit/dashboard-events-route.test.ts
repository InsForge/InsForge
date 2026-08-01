import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  formatDashboardEvent,
  handleDashboardEvents,
} from '../../src/api/routes/dashboard/events.routes.js';
import { dashboardEventService } from '../../src/services/dashboard/dashboard-event.service.js';

// The route module pulls in the auth middleware, which requires JWT_SECRET at
// import time; vi.hoisted runs before the imports above are evaluated.
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({}),
  },
}));

function createResponse() {
  const emitter = new EventEmitter();
  const response = Object.assign(emitter, {
    status: vi.fn(() => response),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
  });
  return response;
}

describe('dashboard event stream', () => {
  it('formats events as SSE data frames', () => {
    expect(formatDashboardEvent({ type: 'data-update', resource: 'users' })).toBe(
      'data: {"type":"data-update","resource":"users"}\n\n'
    );
  });

  it('streams dashboard events and unsubscribes when the response closes', () => {
    const response = createResponse();
    handleDashboardEvents({} as Request, response as unknown as Response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(response.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(response.write).toHaveBeenCalledWith('data: {"type":"ready"}\n\n');

    dashboardEventService.publishDataUpdate({ resource: 'compute_services' });
    expect(response.write).toHaveBeenCalledWith(
      'data: {"type":"data-update","resource":"compute_services"}\n\n'
    );

    const writesBeforeClose = response.write.mock.calls.length;
    response.emit('close');
    dashboardEventService.publishDataUpdate({ resource: 'users' });
    expect(response.write).toHaveBeenCalledTimes(writesBeforeClose);
  });
});
