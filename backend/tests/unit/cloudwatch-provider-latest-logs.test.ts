import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
  type FilteredLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import { CloudWatchProvider } from '../../src/providers/logs/cloudwatch.provider';

vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const NOW = Date.parse('2026-10-11T09:00:00.000Z');
const STREAM = 'p-us-east-2-insforge-vector';
const PAGE_SIZE = 10000;

// Serves FilterLogEvents like CloudWatch: inclusive time range, oldest first, paginated.
function providerWith(events: FilteredLogEvent[]) {
  const filterCalls: Array<{ startTime?: number; endTime?: number }> = [];
  const send = vi.fn(async (cmd: unknown) => {
    if (cmd instanceof DescribeLogStreamsCommand) {
      return { logStreams: [{ logStreamName: STREAM }] };
    }
    if (cmd instanceof FilterLogEventsCommand) {
      filterCalls.push({ startTime: cmd.input.startTime, endTime: cmd.input.endTime });
      const { startTime = 0, endTime = Infinity, nextToken } = cmd.input;
      const inRange = events.filter(
        (e) => (e.timestamp ?? 0) >= startTime && (e.timestamp ?? 0) <= endTime
      );
      const offset = nextToken ? Number(nextToken) : 0;
      const page = inRange.slice(offset, offset + PAGE_SIZE);
      const next = offset + PAGE_SIZE < inRange.length ? String(offset + PAGE_SIZE) : undefined;
      return { events: page, nextToken: next };
    }
    throw new Error(`unexpected command ${String(cmd)}`);
  });
  const provider = new CloudWatchProvider();
  Object.assign(provider, { cwClient: { send }, cwLogGroup: '/insforge/test' });
  return { provider, filterCalls };
}

function event(timestamp: number): FilteredLogEvent {
  return {
    eventId: String(timestamp),
    timestamp,
    logStreamName: STREAM,
    message: JSON.stringify({ level: 'info', message: `at ${timestamp}` }),
  };
}

describe('CloudWatchProvider.getLogsBySource latest logs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the newest events when the last 24h hold more than the page cap', async () => {
    // above the provider's 50,000-event safety cap even after it overshoots by a page
    const count = 80000;
    const step = Math.floor((24 * 60 * 60 * 1000) / count);
    const events = Array.from({ length: count }, (_, i) => event(NOW - (count - 1 - i) * step));

    const { provider, filterCalls } = providerWith(events);
    const result = await provider.getLogsBySource('insforge.logs', 100);

    expect(result.logs).toHaveLength(100);
    expect(result.logs.map((l) => l.id)).toEqual(events.slice(-100).map((e) => e.eventId));
    expect(filterCalls.every((c) => (c.startTime ?? 0) >= NOW - 5 * 60 * 1000)).toBe(true);
  });

  it('widens the window for sparse logs without duplicating a boundary event', async () => {
    const events = [
      event(NOW - 3 * 60 * 60 * 1000),
      event(NOW - 5 * 60 * 1000),
      event(NOW - 2 * 60 * 1000),
    ];

    const { provider } = providerWith(events);
    const result = await provider.getLogsBySource('insforge.logs', 100);

    expect(result.logs.map((l) => l.id)).toEqual(events.map((e) => e.eventId));
  });
});
