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

// Serves FilterLogEvents like CloudWatch: inclusive time range, `limit` per page (default 10,000),
// pages no longer than `pageSize`, newest first when startFromHead is false; limit below 1 is rejected.
function providerWith(events: FilteredLogEvent[], pageSize = Infinity) {
  const calls: Array<{ startFromHead?: boolean; limit?: number }> = [];
  const send = vi.fn(async (cmd: unknown) => {
    if (cmd instanceof DescribeLogStreamsCommand) {
      return { logStreams: [{ logStreamName: STREAM }] };
    }
    if (cmd instanceof FilterLogEventsCommand) {
      const { startTime = 0, endTime = Infinity, startFromHead, limit, nextToken } = cmd.input;
      calls.push({ startFromHead, limit });
      if (limit !== undefined && limit < 1) {
        throw new Error('InvalidParameterException: limit must be at least 1');
      }
      const inRange = events.filter(
        (e) => (e.timestamp ?? 0) >= startTime && (e.timestamp ?? 0) <= endTime
      );
      const ordered = startFromHead === false ? [...inRange].reverse() : inRange;
      const offset = nextToken ? Number(nextToken) : 0;
      const size = Math.min(limit ?? 10000, pageSize);
      const page = ordered.slice(offset, offset + size);
      const next = offset + size < ordered.length ? String(offset + size) : undefined;
      return { events: page, nextToken: next };
    }
    throw new Error(`unexpected command ${String(cmd)}`);
  });
  const provider = new CloudWatchProvider();
  Object.assign(provider, { cwClient: { send }, cwLogGroup: '/insforge/test' });
  return { provider, calls };
}

function event(timestamp: number): FilteredLogEvent {
  return {
    eventId: `id-${timestamp}`,
    timestamp,
    logStreamName: STREAM,
    message: JSON.stringify({ level: 'info', message: `at ${timestamp}` }),
  };
}

const ids = (events: FilteredLogEvent[]) => events.map((e) => e.eventId);

describe('CloudWatchProvider.getLogsBySource latest logs', () => {
  // the provider reads the last 24h relative to Date.now(), so the fixtures need a pinned clock
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the newest events of a busy group oldest-first, in one newest-first read', async () => {
    const events = Array.from({ length: 80000 }, (_, i) => event(NOW - (80000 - i) * 1000));

    const { provider, calls } = providerWith(events);
    const result = await provider.getLogsBySource('insforge.logs', 100);

    expect(result.logs.map((l) => l.id)).toEqual(ids(events.slice(-100)));
    expect(calls).toEqual([{ startFromHead: false, limit: 100 }]);
  });

  it('pages backward past short pages and asks only for what is still missing', async () => {
    const events = Array.from({ length: 500 }, (_, i) => event(NOW - (500 - i) * 1000));

    const { provider, calls } = providerWith(events, 120);
    const result = await provider.getLogsBySource('insforge.logs', 200);

    expect(result.logs.map((l) => l.id)).toEqual(ids(events.slice(-200)));
    expect(calls.map((c) => c.limit)).toEqual([200, 80]);
  });

  it('returns everything a sparse group has', async () => {
    const events = [event(NOW - 20 * 60 * 60 * 1000), event(NOW - 60 * 1000), event(NOW)];

    const { provider } = providerWith(events);
    const result = await provider.getLogsBySource('insforge.logs', 100);

    expect(result.logs.map((l) => l.id)).toEqual(ids(events));
  });

  it('clamps limit to what FilterLogEvents accepts', async () => {
    const { provider, calls } = providerWith([event(NOW)]);

    await provider.getLogsBySource('insforge.logs', 0);
    await provider.getLogsBySource('insforge.logs', 50000);

    expect(calls.map((c) => c.limit)).toEqual([100, 10000]);
  });

  it('falls back to the newest events before the cursor when Insights fails', async () => {
    const events = Array.from({ length: 1000 }, (_, i) => event(NOW - (1000 - i) * 1000));

    const { provider } = providerWith(events);
    const result = await provider.getLogsBySource(
      'insforge.logs',
      100,
      new Date(NOW - 100 * 1000).toISOString()
    );

    expect(result.logs.map((l) => l.id)).toEqual(ids(events.slice(800, 900)));
  });
});
