import { describe, expect, it } from 'vitest';
import type { LogSchema } from '@insforge/shared-schemas';
import { filterFunctionLogs, type FunctionLogFilters } from '#features/logs/helpers';

const logs: LogSchema[] = [
  {
    id: '1',
    timestamp: '2026-09-29T10:00:00.000Z',
    eventMessage: 'POST orders 500 17ms',
    body: { slug: 'orders', requestId: 'abc-123', status: 500, durationMs: 17 },
  },
  {
    id: '2',
    timestamp: '2026-09-29T11:00:00.000Z',
    eventMessage: 'GET users 200 3ms',
    body: { slug: 'users', requestId: 'def-456', status: 200, durationMs: 3 },
  },
  {
    id: '3',
    timestamp: '2026-09-29T12:00:00.000Z',
    eventMessage: 'unstructured log',
    body: { event_message: 'unstructured log' },
  },
];

const emptyFilters: FunctionLogFilters = {
  functionSlug: '',
  requestId: '',
  status: '',
  from: '',
  to: '',
};

describe('filterFunctionLogs', () => {
  it('matches function, status, and request ID together', () => {
    const filtered = filterFunctionLogs(logs, {
      ...emptyFilters,
      functionSlug: 'orders',
      status: '500',
      requestId: ' ABC-123 ',
    });
    expect(filtered.map((log) => log.id)).toEqual(['1']);
  });

  it('uses an inclusive time range and excludes logs without matching metadata', () => {
    const filtered = filterFunctionLogs(logs, {
      ...emptyFilters,
      status: '200',
      from: '2026-09-29T11:00:00.000Z',
      to: '2026-09-29T11:00:00.000Z',
    });
    expect(filtered.map((log) => log.id)).toEqual(['2']);
  });

  it('keeps ordinary runtime logs when no structured filter is active', () => {
    expect(filterFunctionLogs(logs, emptyFilters)).toEqual(logs);
  });
});
